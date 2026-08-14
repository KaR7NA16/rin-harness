import type { ReactElement, ReactNode } from 'react'
import type { Mounted, MountedTrue } from '../api'
import type { ApiState } from '../useApi'
import { ErrorBox } from './ErrorBox'
import { Loading } from './Loading'
import { MountedNotice } from './MountedNotice'

/** Loading/error gate for v1 endpoints (no mounted envelope). */
export function ViewGate<T>(props: {
  state: ApiState<T>
  children: (data: T) => ReactNode
}): ReactElement {
  const { state, children } = props
  if (state.loading) return <Loading />
  if (state.error !== null) return <ErrorBox message={state.error} />
  if (state.data === null) return <Loading />
  return <>{children(state.data)}</>
}

/** Loading/error/mounted gate for v2 endpoints ({"mounted":...} envelope). */
export function ServiceGate<T>(props: {
  state: ApiState<Mounted<T>>
  children: (data: MountedTrue<T>) => ReactNode
}): ReactElement {
  const { state, children } = props
  if (state.loading) return <Loading />
  if (state.error !== null) return <ErrorBox message={state.error} />
  if (state.data === null) return <Loading />
  if (state.data.mounted === false) return <MountedNotice />
  return <>{children(state.data)}</>
}
