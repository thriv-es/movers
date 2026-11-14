import { useRouteError } from 'react-router'

/**
 * Root error boundary for react-router. Pass as the `errorElement` on your root route.
 *
 * @see https://reactrouter.com/en/main/route/error-element
 */
export function RouterRootErrorBoundary(): JSX.Element {
  const error = useRouteError() as Error
  return (
    <section>
      <h1>There was an error 😩</h1>
      <pre>{error.message || JSON.stringify(error)}</pre>
      <button
        type="button"
        onClick={() => {
          if (typeof window !== 'undefined') {
            window.location.href = '/'
          }
        }}
      >
        Reload
      </button>
    </section>
  )
}
