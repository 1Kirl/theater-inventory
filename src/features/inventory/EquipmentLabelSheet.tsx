import { QRCodeSVG } from 'qrcode.react'
import type { EquipmentLabel } from '@/features/inventory/equipment-label'

/**
 * A sheet of physical labels, sized in millimetres because that is what comes
 * out of the printer.
 *
 * 50 × 30 mm: large enough that the QR survives being stuck on a scuffed
 * microphone and read across a dim booth, small enough to fit on a cable end.
 * The QR itself is 22 mm square, comfortably above the ~15 mm where phone
 * cameras start to struggle at arm's length.
 *
 * Error correction is set to M rather than L: a label on theatre equipment gets
 * scratched, taped over, and handled in the dark, and the extra redundancy costs
 * nothing at this size. No logo is placed over the centre, which is what that
 * redundancy would otherwise have to pay for.
 */
const LABEL_WIDTH_MM = 50
const LABEL_HEIGHT_MM = 30
const QR_SIZE_MM = 22

export function EquipmentLabelSheet({ labels }: { labels: readonly EquipmentLabel[] }) {
  return (
    <div className="equipment-label-sheet" data-label-count={labels.length}>
      {labels.map((label) => (
        <div key={label.qrUrl} className="equipment-label">
          <div className="equipment-label__qr">
            <QRCodeSVG
              value={label.qrUrl}
              // Millimetres, so the printed square is the physical size meant
              // rather than whatever the screen's pixel density implies.
              size={QR_SIZE_MM}
              level="M"
              marginSize={0}
              bgColor="#ffffff"
              fgColor="#000000"
              style={{ width: `${String(QR_SIZE_MM)}mm`, height: `${String(QR_SIZE_MM)}mm` }}
            />
          </div>
          <div className="equipment-label__text">
            <p className="equipment-label__code">{label.assetCode}</p>
            <p className="equipment-label__item">{label.itemName}</p>
            {label.organizationName ? (
              <p className="equipment-label__org">{label.organizationName}</p>
            ) : null}
          </div>
        </div>
      ))}

      <style>{`
        .equipment-label-sheet {
          display: flex;
          flex-wrap: wrap;
          gap: 4mm;
          align-content: flex-start;
        }

        .equipment-label {
          width: ${String(LABEL_WIDTH_MM)}mm;
          height: ${String(LABEL_HEIGHT_MM)}mm;
          display: flex;
          align-items: center;
          gap: 2mm;
          padding: 2mm;
          border: 0.2mm dashed #999;
          border-radius: 1mm;
          background: #fff;
          color: #000;
          box-sizing: border-box;
          overflow: hidden;
          /* A label split across two sheets is a wasted label. */
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .equipment-label__qr { flex: 0 0 auto; line-height: 0; }

        .equipment-label__text {
          min-width: 0;
          font-family: ui-sans-serif, system-ui, sans-serif;
          line-height: 1.15;
        }

        .equipment-label__code {
          font-size: 3.6mm;
          font-weight: 700;
          font-family: ui-monospace, monospace;
          margin: 0;
          overflow-wrap: anywhere;
        }

        .equipment-label__item {
          font-size: 2.6mm;
          margin: 0.6mm 0 0;
          /* Two lines at most, so a long name cannot push the org off the label. */
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }

        .equipment-label__org {
          font-size: 2.2mm;
          margin: 0.6mm 0 0;
          color: #444;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        @media print {
          /* Nothing of the application comes with the labels: no sidebar, no
             dialog chrome, no buttons. */
          body > *:not(.equipment-print-root) { display: none !important; }

          .equipment-print-root {
            position: static !important;
            display: block !important;
            background: #fff !important;
          }

          .equipment-label-sheet { gap: 3mm; }

          .equipment-label {
            border-color: #bbb;
            /* Printers drop light backgrounds unless asked; a QR needs its
               white quiet zone to scan. */
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
        }
      `}</style>
    </div>
  )
}
