import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { OrganizationProvider } from '@/features/organizations/OrganizationProvider'
import { router } from '@/routes/router'
import '@/index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root was not found in index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <AuthProvider>
      <OrganizationProvider>
        <RouterProvider router={router} />
      </OrganizationProvider>
    </AuthProvider>
  </StrictMode>,
)
