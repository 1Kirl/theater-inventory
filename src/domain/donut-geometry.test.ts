import { describe, expect, it } from 'vitest'
import { arcPath, donutArcs } from '@/domain/donut-geometry'

const slice = (key: string, value: number) => ({ key, value })

describe('the ring is divided exactly', () => {
  it('1. two equal slices take half each', () => {
    const arcs = donutArcs([slice('a', 1), slice('b', 1)])
    expect(arcs).toEqual([
      { key: 'a', startAngle: 0, endAngle: 180 },
      { key: 'b', startAngle: 180, endAngle: 360 },
    ])
  })

  it('2. a slice’s span is its exact share of the whole', () => {
    const arcs = donutArcs([slice('a', 1), slice('b', 3)])
    expect(arcs[0]?.endAngle).toBe(90)
    expect((arcs[1]?.endAngle ?? 0) - (arcs[1]?.startAngle ?? 0)).toBe(270)
  })

  it('3. the first slice starts at twelve o’clock', () => {
    expect(donutArcs([slice('a', 5), slice('b', 5)])[0]?.startAngle).toBe(0)
  })
})

describe('nothing overlaps and nothing is left over', () => {
  it('4. each arc begins exactly where the previous one ended', () => {
    const arcs = donutArcs([
      slice('available', 6), slice('unusable', 1), slice('in_use', 2),
      slice('maintenance', 1), slice('lost', 3), slice('retired', 4),
    ])

    for (let index = 1; index < arcs.length; index += 1) {
      expect(arcs[index]?.startAngle).toBe(arcs[index - 1]?.endAngle)
    }
  })

  it('5. the last arc closes the ring at exactly 360', () => {
    // A contract, not a repair: for integer counts the running total already
    // lands on 360 exactly. Pinned anyway so closure does not depend on that.
    const arcs = donutArcs([slice('a', 1), slice('b', 1), slice('c', 1)])
    expect(arcs.at(-1)?.endAngle).toBe(360)
  })

  it('6. the wrap-around boundary is a single shared angle', () => {
    const arcs = donutArcs([slice('retired', 7), slice('available', 11), slice('lost', 3)])
    expect(arcs[0]?.startAngle).toBe(0)
    expect(arcs.at(-1)?.endAngle).toBe(360)
  })

  it('7. the spans add up to a full turn for awkward divisions', () => {
    for (const values of [[1, 1, 1], [1, 2, 3, 5, 7, 11], [99, 1], [1, 999]]) {
      const arcs = donutArcs(values.map((value, index) => slice(String(index), value)))
      const span = arcs.reduce((sum, arc) => sum + (arc.endAngle - arc.startAngle), 0)
      expect(span).toBeCloseTo(360, 9)
    }
  })

  it('8. proportions survive the closing adjustment', () => {
    const arcs = donutArcs([slice('a', 1), slice('b', 1), slice('c', 1)])
    for (const arc of arcs) {
      expect(arc.endAngle - arc.startAngle).toBeCloseTo(120, 6)
    }
  })
})

describe('degenerate rings', () => {
  it('9. a single slice is the whole ring', () => {
    expect(donutArcs([slice('a', 10)])).toEqual([{ key: 'a', startAngle: 0, endAngle: 360 }])
  })

  it('10. zero-value slices are not drawn', () => {
    const arcs = donutArcs([slice('a', 0), slice('b', 5), slice('c', 0)])
    expect(arcs.map((arc) => arc.key)).toEqual(['b'])
    expect(arcs[0]?.endAngle).toBe(360)
  })

  it('11. an all-zero ring draws nothing', () => {
    expect(donutArcs([slice('a', 0), slice('b', 0)])).toEqual([])
  })

  it('12. an empty ring draws nothing', () => {
    expect(donutArcs([])).toEqual([])
  })

  it('13. a negative value is not drawn', () => {
    expect(donutArcs([slice('a', -5), slice('b', 5)]).map((arc) => arc.key)).toEqual(['b'])
  })
})

describe('the path each arc becomes', () => {
  it('14. starts at the top of the circle for a zero angle', () => {
    expect(arcPath(66, 66, 57, 0, 90)).toMatch(/^M 66 9 /)
  })

  it('15. sweeps clockwise', () => {
    // Sweep flag 1 is clockwise in SVG's coordinate system.
    expect(arcPath(66, 66, 57, 0, 90)).toContain('A 57 57 0 0 1')
  })

  it('16. sets the large-arc flag only past a half turn', () => {
    expect(arcPath(66, 66, 57, 0, 90)).toContain('0 0 1')
    expect(arcPath(66, 66, 57, 0, 180)).toContain('0 0 1')
    expect(arcPath(66, 66, 57, 0, 181)).toContain('0 1 1')
    expect(arcPath(66, 66, 57, 0, 359)).toContain('0 1 1')
  })

  it('17. draws a complete ring as two half turns, which one arc cannot do', () => {
    const path = arcPath(66, 66, 57, 0, 360)
    expect(path.match(/A /g)).toHaveLength(2)
  })

  it('18. a quarter turn ends at three o’clock', () => {
    expect(arcPath(66, 66, 57, 0, 90)).toMatch(/123 66$/)
  })

  it('19. every arc of a real ring produces a usable path', () => {
    const arcs = donutArcs([
      slice('available', 6), slice('unusable', 1), slice('in_use', 2),
      slice('maintenance', 1), slice('lost', 3), slice('retired', 4),
    ])

    for (const arc of arcs) {
      const path = arcPath(66, 66, 57, arc.startAngle, arc.endAngle)
      expect(path).toMatch(/^M [\d.-]+ [\d.-]+ A /)
      expect(path).not.toContain('NaN')
    }
  })
})
