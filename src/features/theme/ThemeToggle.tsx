import { Moon, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { themeToggleLabel } from '@/domain/theme'
import { useTheme } from '@/features/theme/useTheme'

/**
 * The control that switches theme, sized to sit beside the other header icons.
 *
 * The icon shows the destination rather than the current state — a moon while
 * light is active — which is the convention users arrive with, and the reason
 * the accessible name says where pressing it goes instead of naming a mode. The
 * name is on the button itself, so the icon is hidden from assistive technology
 * rather than announced twice.
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const label = themeToggleLabel(theme)

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-8"
      aria-label={label}
      title={label}
      onClick={toggleTheme}
    >
      {theme === 'dark'
        ? <Sun className="size-4" aria-hidden="true" />
        : <Moon className="size-4" aria-hidden="true" />}
    </Button>
  )
}
