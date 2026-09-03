import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Link2, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EquipmentLabelPrinter } from '@/features/inventory/EquipmentLabelPrinter'
import { equipmentLabel } from '@/features/inventory/equipment-label'
import type { InventoryItem, InventoryUnit } from '@/types/inventory'
import type { Organization } from '@/types/organization'

/**
 * The QR for one unit, on its own detail page.
 *
 * The code shown here is the same one a printed sticker carries, generated from
 * the unit's document id — so a label printed a year ago still opens this page,
 * whatever has happened to the equipment since. Renaming an asset code, moving
 * it between crews, sending it for repair, retiring it: none of them change the
 * link, because none of them change the identity.
 *
 * The code is drawn in the browser. No image service sees which organization is
 * labelling what.
 */
export function EquipmentQrCard({
  unit,
  item,
  organization,
}: {
  unit: InventoryUnit
  item: InventoryItem | null
  organization: Organization | null
}) {
  const [printing, setPrinting] = useState(false)
  const [copied, setCopied] = useState(false)

  const label = equipmentLabel({ unit, item, organization })

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(label.qrUrl)
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 2000)
    } catch {
      // Clipboard access is refused often enough — an insecure origin, a
      // browser setting — that failing loudly would be worse than the link
      // simply staying on screen for the person to copy by hand.
      setCopied(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Label</CardTitle>
        <CardDescription>
  Any phone camera opens this page. The link never changes, so a label is printed once.
</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="bg-white rounded-md border p-3 self-start">
          <QRCodeSVG value={label.qrUrl} size={128} level="M" marginSize={0} />
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-muted-foreground text-xs break-all font-mono">{label.qrUrl}</p>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { setPrinting(true) }}>
              <Printer className="size-4" aria-hidden="true" />
              Print label
            </Button>
            <Button size="sm" variant="outline" onClick={() => { void copyLink() }}>
              {copied
                ? <Check className="size-4" aria-hidden="true" />
                : <Link2 className="size-4" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy equipment link'}
            </Button>
          </div>

          <p className="text-muted-foreground text-xs">
            Anyone who opens the link still has to sign in, and still only sees this equipment if
            they are in this organization with inventory access.
          </p>
        </div>
      </CardContent>

      <EquipmentLabelPrinter labels={[label]} open={printing} onOpenChange={setPrinting} />
    </Card>
  )
}
