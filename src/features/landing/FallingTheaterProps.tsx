import { useEffect, useRef, useState } from 'react'
import {
  CASCADE_MS, GLYPH_RADIUS_RATIO, PHYSICS, STATIC_PROP_COUNT, THEATER_PROPS,
  densityFor, nextDropDelay, spawnFor, type TheaterProp,
} from '@/features/landing/theater-props'

/**
 * The atmosphere: production equipment falling behind the page, under vellum.
 *
 * Two fixed layers, both decorative and both inert. The props settle against
 * the bottom of the viewport rather than the document, so the pile stays put
 * while the page scrolls over it, and the vellum above them is what turns a row
 * of emoji into background texture.
 *
 * Matter.js is confined to this file and reached by dynamic import, so it is
 * its own chunk: the landing page renders and is readable before any physics
 * arrives, and a signed-in visitor who never sees this page never downloads it.
 * Nothing else on the landing page uses it — the hero, the showcase and the
 * workflow stay on the CSS and IntersectionObserver primitives they already
 * have.
 *
 * The engine is the only thing that runs per frame. React state holds the list
 * of props, which changes when one spawns or is recycled and at no other time;
 * positions are written straight to `style.transform` through refs. A state
 * update per body per frame is the version of this component that drops frames.
 */

interface PropRecord {
  id: number
  prop: TheaterProp
  size: number
}

/**
 * Whether the page wants atmospheric motion, asked of the stylesheet.
 *
 * The JavaScript media-query API is banned across `src/`, and reduced motion
 * here is settled the same way it is everywhere else on this page: in CSS. `landing.css` sets this
 * property to 0 inside `prefers-reduced-motion`, and this reads the computed
 * value once. The limitation that comes with it is real and worth stating: a
 * visitor who changes the preference while the page is already open keeps
 * whatever it was at load. Everything else about the page responds live,
 * because everything else is a CSS rule rather than a decision JavaScript made.
 */
function physicsMotionEnabled(root: HTMLElement): boolean {
  const value = getComputedStyle(root).getPropertyValue('--landing-physics-motion').trim()
  return value !== '0'
}

export function FallingTheaterProps() {
  const layerRef = useRef<HTMLDivElement | null>(null)
  const nodesRef = useRef(new Map<number, HTMLSpanElement>())
  /** Set once the engine exists; places a newly mounted node at its body. */
  const placeRef = useRef<((id: number, node: HTMLSpanElement) => void) | null>(null)
  const [props, setProps] = useState<PropRecord[]>([])

  useEffect(() => {
    const layer = layerRef.current
    if (layer === null) return

    // Captured, because cleanup must clear the map this effect filled rather
    // than whichever one the ref points at by the time it runs.
    const nodes = nodesRef.current

    if (!physicsMotionEnabled(layer)) {
      /*
       * The pile as it would have ended up, without ever having moved.
       *
       * Placement is a class and an index rather than inline geometry, so this
       * branch shares the render path with the moving one and Matter is never
       * imported at all — no engine, no loop, no scheduled drop.
       */
      layer.dataset.settled = 'true'
      setProps(Array.from({ length: STATIC_PROP_COUNT }, (_, index) => ({
        id: index,
        prop: THEATER_PROPS[index * 2] ?? THEATER_PROPS[index] ?? THEATER_PROPS[0],
        size: 0,
      })))
      return () => { nodes.clear() }
    }

    let disposed = false
    // Everything the running simulation owns, so teardown is one pass over a
    // single object rather than a list of variables that has to stay in step.
    const live = {
      frame: 0,
      spawnTimer: 0 as ReturnType<typeof setTimeout> | 0,
      cascade: [] as ReturnType<typeof setTimeout>[],
      teardown: () => {},
    }

    void (async () => {
      const Matter = await import('matter-js')
      if (disposed) return

      const { Bodies, Body, Composite, Engine, Sleeping } = Matter

      const engine = Engine.create({ enableSleeping: true })
      engine.gravity.y = PHYSICS.gravity

      let viewport = { width: window.innerWidth, height: window.innerHeight }
      let policy = densityFor(viewport.width)
      let nextId = 0

      /*
       * The world is the viewport, not the document.
       *
       * The walls are thick and centred outside the edges rather than on them,
       * so a fast body cannot pass through one between two steps. The floor
       * carries no visible surface: props simply stop at the bottom of whatever
       * the visitor can see.
       */
      const THICKNESS = 200
      const wallOptions = { isStatic: true, friction: PHYSICS.friction, restitution: 0.1 }
      let bounds = buildBounds()

      function buildBounds() {
        const { width, height } = viewport
        const walls = [
          Bodies.rectangle(width / 2, height + THICKNESS / 2, width * 3, THICKNESS, wallOptions),
          Bodies.rectangle(-THICKNESS / 2, height / 2, THICKNESS, height * 4, wallOptions),
          Bodies.rectangle(width + THICKNESS / 2, height / 2, THICKNESS, height * 4, wallOptions),
        ]
        Composite.add(engine.world, walls)
        return walls
      }

      const bodies = new Map<number, Matter.Body>()
      placeRef.current = (id, node) => {
        const body = bodies.get(id)
        if (body) place(node, body)
      }

      function drop() {
        // The ceiling is enforced before adding, so the count never overshoots.
        while (bodies.size >= policy.maximum) recycleOldest()

        const state = spawnFor(viewport.width, policy, Math.random)
        const id = nextId++
        // A circle: the pile stands up predictably, and the vellum above hides
        // that the silhouette is not the emoji's. Sized to the drawn glyph
        // rather than the em box, so a prop comes to rest on the floor rather
        // than through it.
        const body = Bodies.circle(state.x, state.y, state.size * GLYPH_RADIUS_RATIO, {
          restitution: PHYSICS.restitution,
          friction: PHYSICS.friction,
          frictionStatic: PHYSICS.frictionStatic,
          frictionAir: PHYSICS.frictionAir,
          density: PHYSICS.density,
          slop: PHYSICS.slop,
          sleepThreshold: PHYSICS.sleepThreshold,
        })

        Body.setAngle(body, state.angle)
        Body.setVelocity(body, { x: state.velocityX, y: 0 })
        Body.setAngularVelocity(body, state.angularVelocity)

        bodies.set(id, body)
        Composite.add(engine.world, body)
        setProps((current) => [...current, { id, prop: state.prop, size: state.size }])
      }

      /** Body position to DOM transform. The only thing written per frame. */
      function place(node: HTMLSpanElement, body: Matter.Body) {
        node.style.transform =
          `translate3d(${body.position.x}px, ${body.position.y}px, 0)`
          + ` rotate(${body.angle}rad) translate(-50%, -50%)`
      }

      /** The oldest body, and the DOM node and record that went with it. */
      function recycleOldest() {
        const oldest = bodies.keys().next()
        if (oldest.done) return

        const id = oldest.value
        const body = bodies.get(id)
        if (body) Composite.remove(engine.world, body)
        bodies.delete(id)
        nodesRef.current.delete(id)
        setProps((current) => current.filter((record) => record.id !== id))
      }

      function scheduleDrop() {
        live.spawnTimer = setTimeout(() => {
          // Never while nobody is looking. The timer is rescheduled from the
          // moment it fires rather than queued, so a long hidden spell releases
          // nothing in a burst on return.
          if (!document.hidden) drop()
          scheduleDrop()
        }, nextDropDelay(policy, Math.random))
      }

      /*
       * The entrance waits for somebody to be there.
       *
       * A page opened in a background tab would otherwise spend its cascade
       * unseen and be a settled pile by the time it is looked at — and, since
       * the loop below does not step while hidden, would spend that time with
       * every prop still at the origin. Deferring it means the visitor gets the
       * entrance when they arrive, whenever that is.
       */
      function begin() {
        // Staggered rather than released together, so it reads as things
        // arriving one at a time.
        for (let index = 0; index < policy.initial; index += 1) {
          const at = (index / policy.initial) * CASCADE_MS + Math.random() * 180
          live.cascade.push(setTimeout(drop, at))
        }
        scheduleDrop()
      }

      const onVisible = () => {
        if (document.hidden) return
        document.removeEventListener('visibilitychange', onVisible)
        begin()
      }
      if (document.hidden) document.addEventListener('visibilitychange', onVisible)
      else begin()

      /*
       * One loop for every body.
       *
       * Physics is stepped, then each body's position and angle — which the
       * engine already holds — is written to its node's transform. Nothing is
       * measured, nothing is read back from layout, and no state is set.
       */
      let last = performance.now()
      const step = (now: number) => {
        live.frame = requestAnimationFrame(step)

        if (document.hidden) { last = now; return }

        // Matter documents 16.667ms as the largest step it stays stable at, and
        // says so on the console for every step above it. Clamping there costs
        // a little simulated time on a slow frame — the pile falls fractionally
        // slower under load — and buys a solver that does not come apart, plus
        // no chance of integrating one enormous step after a hidden spell and
        // firing the whole pile across the screen.
        const delta = Math.min(now - last, 16.667)
        last = now
        Engine.update(engine, delta)

        /*
         * Only what moved.
         *
         * A settled pile is the page's resting state, and it lasts for as long
         * as the visitor stays. Writing thirty-four transforms every frame for
         * bodies that are asleep and cannot move is the one piece of real waste
         * in this loop, and skipping it is safe without any wake detection: a
         * body's last awake frame already wrote its final position, and a body
         * that has just been added is placed by its own ref on mount.
         */
        for (const [id, body] of bodies) {
          if (body.isSleeping) continue
          const node = nodes.get(id)
          if (node !== undefined) place(node, body)
        }
      }
      live.frame = requestAnimationFrame(step)

      /*
       * A resized viewport is a new world.
       *
       * The old walls are removed rather than left behind — a leaked floor is
       * an invisible shelf bodies rest on — and anything now outside the new
       * bounds is nudged back in and woken so it falls again.
       */
      const onResize = () => {
        viewport = { width: window.innerWidth, height: window.innerHeight }
        policy = densityFor(viewport.width)

        Composite.remove(engine.world, bounds)
        bounds = buildBounds()

        for (const body of bodies.values()) {
          const x = Math.min(Math.max(body.position.x, 20), viewport.width - 20)
          const y = Math.min(body.position.y, viewport.height - 20)
          if (x !== body.position.x || y !== body.position.y) {
            Body.setPosition(body, { x, y })
            Sleeping.set(body, false)
          }
        }
        while (bodies.size > policy.maximum) recycleOldest()
      }
      window.addEventListener('resize', onResize, { passive: true })

      live.teardown = () => {
        document.removeEventListener('visibilitychange', onVisible)
        window.removeEventListener('resize', onResize)
        Composite.clear(engine.world, false)
        Engine.clear(engine)
        bodies.clear()
      }
    })()

    return () => {
      disposed = true
      cancelAnimationFrame(live.frame)
      placeRef.current = null
      if (live.spawnTimer) clearTimeout(live.spawnTimer)
      for (const timer of live.cascade) clearTimeout(timer)
      live.teardown()
      nodes.clear()
      setProps([])
    }
  }, [])

  return (
    <>
      <div ref={layerRef} className="landing-atmosphere" aria-hidden="true">
        {props.map((record) => (
          <span
            key={record.id}
            ref={(node) => {
              if (node) {
                nodesRef.current.set(record.id, node)
                // Placed on mount, so a prop is never painted at the origin
                // waiting for a frame that has not run yet.
                placeRef.current?.(record.id, node)
              } else {
                nodesRef.current.delete(record.id)
              }
            }}
            className="landing-prop"
            style={record.size > 0 ? { fontSize: `${record.size}px` } : undefined}
          >
            {record.prop}
          </span>
        ))}
      </div>

      {/* Milky, grained, and static: the layer that stops the props reading as
          emoji stuck on a website and starts them reading as paper. */}
      <div className="landing-vellum" aria-hidden="true" />
    </>
  )
}
