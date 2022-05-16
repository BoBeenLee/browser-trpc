import { AnyRouter, ProcedureType } from '@trpc/server';
import {
  TRPCClientIncomingMessage,
  TRPCClientIncomingRequest,
  TRPCRequest,
  TRPCResponse,
  TRPCResult,
} from '@trpc/server/rpc';
import { TRPCErrorResponse } from '@trpc/server/rpc';
import { ObservableCallbacks, UnsubscribeFn } from '@trpc/client/dist/declarations/src/internals/observable';
import { TRPCLink, TRPCClientError } from '@trpc/client';

type Operation = {
  id: number | string;
  type: ProcedureType;
  input: unknown;
  path: string;
};

type PostMessage = Pick<
  Window,
  'postMessage' | 'addEventListener' | 'removeEventListener'
>;

export interface PostMessageClientOptions {
  identifier?: string; // fot different listener name
  targetOrigin: string;
  PostMessage?: PostMessage;
}

function isJson(str: string) {
  try {
    JSON.parse(str);
  } catch (e) {
    return false;
  }
  return true;
}

export function createPMClient(opts: PostMessageClientOptions) {
  const { targetOrigin, PostMessage: PostMessageImpl = window } = opts;
  /* istanbul ignore next */
  if (!PostMessageImpl) {
    throw new Error('No PostMessage implementation found');
  }
  /**
   * outgoing messages buffer whilst not open
   */
  let outgoing: TRPCRequest[] = [];
  /**
   * pending outgoing requests that are awaiting callback
   */
  type TCallbacks = ObservableCallbacks<
    TRPCResult,
    TRPCClientError<AnyRouter> | TRPCErrorResponse
  >;
  type TRequest = {
    /**
     * Reference to the PostMessage instance this request was made to
     */
    pm: PostMessage;
    type: ProcedureType;
    callbacks: TCallbacks;
    op: Operation;
  };
  const pendingRequests: Record<number | string, TRequest> =
    Object.create(null);
  let dispatchTimer: NodeJS.Timer | number | null = null;
  let connectTimer: NodeJS.Timer | number | null = null;
  const activeConnection = createPM();
  let state: 'open' | 'connecting' | 'closed' = 'connecting';
  /**
   * tries to send the list of messages
   */
  function dispatch() {
    if (state !== 'open' || dispatchTimer) {
      return;
    }
    dispatchTimer = setTimeout(() => {
      dispatchTimer = null;

      if (outgoing.length === 1) {
        // single send
        activeConnection.postMessage(
          JSON.stringify(outgoing.pop()),
          targetOrigin,
        );
      } else {
        // batch send
        activeConnection.postMessage(JSON.stringify(outgoing), targetOrigin);
      }
      // clear
      outgoing = [];
    });
  }
  function closeIfNoPending(conn: PostMessage) {
    // disconnect as soon as there are are no pending result
    const hasPendingRequests = Object.values(pendingRequests).some(
      (p) => p.pm === conn,
    );
    if (!hasPendingRequests) {
      // TODO conn.close();
    }
  }

  function createPM() {
    const conn = PostMessageImpl;
    clearTimeout(connectTimer as any);
    connectTimer = null;

    // open, error 구분 방법
    const handleIncomingRequest = (req: TRPCClientIncomingRequest) => {
      const method = req.method as 'open' | 'close' | 'error';
      if (method === 'open' && conn === activeConnection) {
        state = 'open';
        dispatch();
        return;
      }
      if (method === 'error' && conn === activeConnection) {
        // TODO ERROR
        return;
      }
      if (method === 'close' && conn === activeConnection) {
        handleIncomingCloseRequest();
        return;
      }
    };
    const handleIncomingResponse = (res: TRPCResponse) => {
      const req = res.id !== null && pendingRequests[res.id];
      if (!req) {
        // do something?
        return;
      }
      if ('error' in res) {
        req.callbacks.onError?.(res);
        return;
      }

      req.callbacks.onNext?.(res.result);
      if (req.pm !== activeConnection && conn === activeConnection) {
        const oldPm = req.pm;
        // gracefully replace old connection with this
        req.pm = activeConnection;
        closeIfNoPending(oldPm);
      }

      if (res.result.type === 'stopped' && conn === activeConnection) {
        req.callbacks.onDone?.();
      }
    };
    conn.addEventListener('message', ({ data }) => {
      if (!isJson(data)) {
        return;
      }
      const msg = JSON.parse(data) as TRPCClientIncomingMessage;

      if ('method' in msg) {
        handleIncomingRequest(msg);
      } else {
        handleIncomingResponse(msg);
      }
      if (conn !== activeConnection || state === 'closed') {
        // when receiving a message, we close old connection that has no pending requests
        closeIfNoPending(conn);
      }
    });

    const handleIncomingCloseRequest = () => {
      for (const key in pendingRequests) {
        const req = pendingRequests[key];
        if (req.pm !== conn) {
          continue;
        }
        req.callbacks.onError?.(
          TRPCClientError.from(
            new TRPCPostMessageClosedError('PostMessage closed prematurely'),
          ),
        );
        if (req.type !== 'subscription') {
          delete pendingRequests[key];
          req.callbacks.onDone?.();
        }
      }
    };
    return conn;
  }

  function request(op: Operation, callbacks: TCallbacks): UnsubscribeFn {
    const { type, input, path, id } = op;
    const envelope: TRPCRequest = {
      id,
      jsonrpc: '2.0',
      method: type,
      params: {
        input,
        path,
      },
    };
    pendingRequests[id] = {
      pm: activeConnection,
      type,
      callbacks,
      op,
    };

    // enqueue message
    outgoing.push(envelope);
    dispatch();

    return () => {
      const callbacks = pendingRequests[id]?.callbacks;
      delete pendingRequests[id];
      outgoing = outgoing.filter((msg) => msg.id !== id);

      callbacks?.onDone?.();
      if (op.type === 'subscription') {
        outgoing.push({
          id,
          method: 'subscription.stop',
          params: undefined,
        });
        dispatch();
      }
    };
  }
  return {
    close: () => {
      state = 'closed';
      closeIfNoPending(activeConnection);
    },
    request,
    getConnection() {
      return activeConnection;
    },
  };
}
export type TRPCPostMessageClient = ReturnType<typeof createPMClient>;

export interface PostMessageLinkOptions {
  client: TRPCPostMessageClient;
}
class TRPCPostMessageClosedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TRPCPostMessageClosedError';
    Object.setPrototypeOf(this, TRPCPostMessageClosedError.prototype);
  }
}

class TRPCSubscriptionEndedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TRPCSubscriptionEndedError';
    Object.setPrototypeOf(this, TRPCSubscriptionEndedError.prototype);
  }
}

export function pmLink<TRouter extends AnyRouter>(
  opts: PostMessageLinkOptions,
): TRPCLink<TRouter> {
  // initialized config
  return (runtime) => {
    const { client } = opts;

    return ({ op, prev, onDestroy }) => {
      const { type, input: rawInput, path, id } = op;
      const input = runtime.transformer.serialize(rawInput);
      let isDone = false;
      const unsub = client.request(
        { type, path, input, id },
        {
          onNext(result) {
            if (isDone) {
              return;
            }
            if ('data' in result) {
              const data = runtime.transformer.deserialize(result.data);
              prev({ type: 'data', data });
            } else {
              prev(result);
            }

            if (op.type !== 'subscription') {
              // if it isn't a subscription we don't care about next response
              isDone = true;
              unsub();
            }
          },
          onError(err) {
            if (isDone) {
              return;
            }
            prev(
              err instanceof Error
                ? err
                : TRPCClientError.from({
                  ...err,
                  error: runtime.transformer.deserialize(err.error),
                }),
            );
          },
          onDone() {
            if (isDone) {
              return;
            }
            const result = new TRPCSubscriptionEndedError(
              'Operation ended prematurely',
            );

            prev(TRPCClientError.from(result, { isDone: true }));
            isDone = true;
          },
        },
      );
      onDestroy(() => {
        isDone = true;
        unsub();
      });
    };
  };
}
