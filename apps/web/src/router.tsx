import { Navigate, type RouteObject, createBrowserRouter } from 'react-router'
import { ScreenSpinner } from '@/ui/components/ui/spinner'

import RootLayout from '@/layout/root.layout'
import ErrorPage from '@/pages/error.page'
import IndexPage from '@/pages/index.page'

/**
 * App routes as an array of React Router `RouteObject`s.
 * `/` redirects to the landing site; `/estimate` is the customer flow; `/admin/*` is the local admin.
 */
const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <ErrorPage />,
    hydrateFallbackElement: <ScreenSpinner />,
    children: [
      {
        index: true,
        element: <IndexPage />,
      },
      {
        path: '/estimate',
        async lazy() {
          return { Component: (await import('@/pages/estimate.page')).default }
        },
      },
      {
        path: '/admin',
        async lazy() {
          return { Component: (await import('@/pages/admin/admin.layout')).default }
        },
        children: [
          { index: true, element: <Navigate to="/admin/leads" replace /> },
          {
            path: 'leads',
            async lazy() {
              return { Component: (await import('@/pages/admin/leads.page')).default }
            },
          },
          {
            path: 'movers',
            async lazy() {
              return { Component: (await import('@/pages/admin/movers.page')).default }
            },
          },
          {
            path: 'quote-requests',
            async lazy() {
              return { Component: (await import('@/pages/admin/quote-requests.page')).default }
            },
          },
        ],
      },
    ],
  },
]

/**
 * React Router v7 `BrowserRouter` with all v7 feature flags enabled for future-proofing.
 *
 * @see https://reactrouter.com/upgrading/v6#update-to-latest-v6x
 */
export const router: ReturnType<typeof createBrowserRouter> = createBrowserRouter(routes, {
  future: {
    v7_relativeSplatPath: true,
    v7_startTransition: true,
    v7_fetcherPersist: true,
    v7_normalizeFormMethod: true,
    v7_partialHydration: true,
  },
})
