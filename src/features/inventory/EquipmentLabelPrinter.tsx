import { useCallback, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@/components/ui/button'
import { EquipmentLabelSheet } from '@/features/inventory/EquipmentLabelSheet'
import type { EquipmentLabel } from '@/features/inventory/equipment-label'

interface Props {
  labels: readonly EquipmentLabel[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * A preview of what will come out of the printer, and the button that sends it.
 *
 * Rendered into `document.body` rather than inside the page, because the print
 * stylesheet hides every top-level element except this one — a sheet nested
 * inside the application shell would take the sidebar with it or be hidden
 * along with its parent.
 *
 * Being a direct child of `body` has one consequence worth naming. An open
 * Radix modal sets `pointer-events: none` on `body` and re-enables it only on
 * its own layers, so anything else portalled alongside it inherits the lock:
 * unclickable, and the click falls through to the dialog's overlay, which
 * dismisses it. That is why this is never opened from inside a modal, and why
 * the root sets `pointer-events: auto` for itself regardless — the batch flow
 * hands the sheet over as its dialog closes, and those two things overlap for
 * the length of one close animation.
 *
 * The browser's own print dialog does the rest. No PDF is generated and no
 * server is involved; a school printing a dozen stickers does not need either.
 */
export function EquipmentLabelPrinter({ labels, open, onOpenChange }: Props) {
  // Escape closes it, the way the dialogs elsewhere behave.
  const close = useCallback(() => { onOpenChange(false) }, [onOpenChange])

  useEffect(() => {
    if (!open) return

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close()
    }

    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [open, close])

  if (!open) return null

  return createPortal(
    <div className="equipment-print-root bg-background pointer-events-auto fixed inset-0 z-50 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8">
        <div className="equipment-print-controls flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              {labels.length} label{labels.length === 1 ? '' : 's'}
            </h2>
            <p className="text-muted-foreground text-sm">
              Print at 100% scale — “fit to page” shrinks the codes. Cut along the dashed lines.
            </p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={close}>Close</Button>
            <Button type="button" onClick={() => { window.print() }}>Print</Button>
          </div>
        </div>

        <EquipmentLabelSheet labels={labels} />
      </div>

      <style>{`
        @media print {
          .equipment-print-controls { display: none !important; }
          .equipment-print-root { position: static !important; overflow: visible !important; }
        }
      `}</style>
    </div>,
    document.body,
  )
}
