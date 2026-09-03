import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { logOut } from '@/services/auth-service'
import { paths } from '@/routes/paths'

interface SignOutButtonProps {
  variant?: 'default' | 'outline' | 'ghost' | undefined
  withIcon?: boolean | undefined
}

export function SignOutButton({ variant = 'outline', withIcon = false }: SignOutButtonProps) {
  const navigate = useNavigate()
  const [submitting, setSubmitting] = useState(false)

  async function handleSignOut() {
    setSubmitting(true)
    try {
      await logOut()
      // To the landing page, not the log-in form. Signing out is leaving, and
      // the front door is where leaving puts you; somebody who wants to sign
      // straight back in has Log in in the header there.
      navigate(paths.landing, { replace: true })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Button variant={variant} size="sm" onClick={handleSignOut} disabled={submitting}>
      {withIcon ? <LogOut className="size-4" aria-hidden="true" /> : null}
      {submitting ? 'Signing out…' : 'Sign out'}
    </Button>
  )
}
