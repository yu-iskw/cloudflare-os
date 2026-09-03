import { RpcStub, RpcTarget } from "capnweb";

/**
 * Disposable no-op Cap'n Web subscription. The SPA disposes these on unmount;
 * they carry no server-side work beyond keeping the RPC session honest.
 */
export function dummySub(): RpcStub<{}> {
  return new RpcTarget() as unknown as RpcStub<{}>;
}
