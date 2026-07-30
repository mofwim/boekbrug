// src/hooks/useIsMounted.ts
// [MOTION] "Has this component hydrated on the client yet?" — the guard a
// createPortal(…, document.body) needs, because document does not exist while
// the server renders.
//
// The obvious spelling is `const [m, setM] = useState(false); useEffect(() => setM(true), [])`,
// and it works, but it is a setState fired synchronously from an effect: React
// has to render, commit, then immediately re-render, and the project's lint
// rule (react-hooks/set-state-in-effect) rejects it for exactly that reason.
//
// useSyncExternalStore gives the same answer with no state and no effect. It
// takes two snapshot functions — one used while server-rendering and one on the
// client — so it returns false during SSR and hydration, then true, without a
// wasted render pass. The store never actually changes, so `subscribe` hands
// back a no-op unsubscribe.

import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}
const getClientSnapshot = () => true
const getServerSnapshot = () => false

export function useIsMounted(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot)
}
