import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { AuthProvider } from '@/features/auth/AuthProvider'
import { OrganizationProvider } from '@/features/organizations/OrganizationProvider'
import { ThemeProvider } from '@/features/theme/ThemeProvider'
import { router } from '@/routes/router'
import '@/index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root was not found in index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    {/* Outside auth and organization on purpose: the theme belongs to the
        browser, so signing out or switching organization must not disturb it. */}
    <ThemeProvider>
      <AuthProvider>
        <OrganizationProvider>
          <RouterProvider router={router} />
        </OrganizationProvider>
      </AuthProvider>
    </ThemeProvider>
  </StrictMode>,
)
