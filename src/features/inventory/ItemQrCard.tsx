import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Check, Link2, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EquipmentLabelPrinter } from '@/features/inventory/EquipmentLabelPrinter'
import { inventoryItemLabel } from '@/features/inventory/equipment-label'
import { isSerialized } from '@/domain/inventory'
import type { InventoryItem } from '@/types/inventory'
import type { Organization } from '@/types/organization'

/**
 * The QR for an inventory record.
 *
 * Bulk items have no units, so until now they had no label at all — and a bin of
 * cable is exactly the thing somebody standing in a storage room wants to look
 * up without typing. This code opens the item's page.
 *
 * It identifies the *record*, not a piece of the quantity. Twenty XLR cables are
 * one inventory row and no amount of labelling makes them twenty identities; a
 * label that implied otherwise would be inviting people to check out something
 * the data cannot represent. When it matters which one, that is what promoting
 * to serialized is for, and each unit then gets its own label.
 *
 * Drawn in the browser, like the unit codes. No image service sees which
 * organization is labelling what.
 */
export function ItemQrCard({
  item,
  organization,
}: {
  item: InventoryItem
  organization: Organization | null
}) {
  const [printing, setPrinting] = useState(false)
  const [copied, setCopied] = useState(false)

  const label = inventoryItemLabel({ item, organization })
  const serialized = isSerialized(item)

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(label.qrUrl)
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, 2000)
    } catch {
      // Refused often enough — an insecure origin, a browser setting — that
      // failing loudly would be worse than the link staying on screen to copy.
      setCopied(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Item label</CardTitle>
        <CardDescription>
          {serialized
            ? 'Opens this item’s page. Each unit below has its own label for identifying one '
              + 'specific piece.'
            : 'Stick this on the bin or shelf. Scanning it with any phone camera opens this item’s '
              + 'page, and the link stays the same for as long as the item exists.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center">
        {/* Always white with a black code, in either theme. A dark-mode label is
            unreadable to a scanner, and this is drawn to be printed. */}
        <div className="bg-white rounded-md border p-3 self-start">
          <QRCodeSVG value={label.qrUrl} size={128} level="M" marginSize={0} />
        </div>

        <div className="min-w-0 flex-1 space-y-3">
          <p className="text-muted-foreground text-xs break-all font-mono">{label.qrUrl}</p>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => { setPrinting(true) }}>
              <Printer className="size-4" aria-hidden="true" />
              Print item label
            </Button>
            <Button size="sm" variant="outline" onClick={() => { void copyLink() }}>
              {copied
                ? <Check className="size-4" aria-hidden="true" />
                : <Link2 className="size-4" aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy item link'}
            </Button>
          </div>

          <p className="text-muted-foreground text-xs">
            {serialized
              ? 'Anyone who opens the link still has to sign in, and still only sees this item if '
                + 'they are in this organization with inventory access.'
              : 'This identifies the item record, not one piece of the quantity. Anyone who opens '
                + 'the link still has to sign in, and still only sees it if they are in this '
                + 'organization with inventory access.'}
          </p>
        </div>
      </CardContent>

      <EquipmentLabelPrinter labels={[label]} open={printing} onOpenChange={setPrinting} />
    </Card>
  )
}
