import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import React, { useLayoutEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  PanResponder,
  Platform,
  Pressable,
  Text,
  View,
  type GestureResponderHandlers,
  type LayoutChangeEvent,
  type PanResponderGestureState,
  type PanResponderInstance,
} from "react-native";
import { slotAt, type Frame } from "../shared/layout";
import { TOUCH, Tint, space, type Styles } from "./parts";

/** Movement, in points, before a press on a grip becomes a drag. */
const DRAG_SLOP = 4;
/** Distance from the top or bottom of the viewport where a drag scrolls the page. */
const EDGE = 72;
/** Fastest auto-scroll, in points per frame. */
const MAX_SPEED = 18;

export type ScrollMetrics = { y: number; height: number; contentHeight: number };

/** What the screen draws while a block is lifted. Coordinates are in the block container. */
export type DragView = { id: string; from: number; to: number; origin: Frame; landing: Frame };

type Session = {
  id: string;
  from: number;
  to: number;
  frame: Frame;
  frames: Frame[];
  startScroll: number;
  dx: number;
  dy: number;
  pageY: number;
  lifted: boolean;
  viewport: { top: number; height: number } | null;
  speed: number;
  raf: number | null;
};

type Options = {
  /** Visible block ids in display order. */
  ids: readonly string[];
  /** "xy" for the two-column grid, "y" for one column, where neighbors slide to open a gap. */
  axis: "xy" | "y";
  /** Space between blocks in one column, so a slide opens exactly one block's room. */
  gap: number;
  reduceMotion: boolean;
  metrics: React.MutableRefObject<ScrollMetrics>;
  scrollTo(y: number): void;
  /** The scroll viewport's top and height in window coordinates. */
  measureViewport(callback: (top: number, height: number) => void): void;
  onDrop(from: number, to: number): void;
  /** A press on a grip that did not move (native touch; the web gets a click instead). */
  onTap(id: string): void;
};

/** Where the lifted block lands: the target slot in a grid, the opened gap in one column. */
function landingFrame(session: Session, axis: Options["axis"], to: number): Frame {
  if (to === session.from) return session.frame;
  const target = session.frames[to];
  if (axis === "xy") return target;
  const y = to > session.from ? target.y + target.height - session.frame.height : target.y;
  return { ...session.frame, y };
}

/**
 * Drag to reorder with React Native primitives only: a PanResponder on each grip, Animated
 * transforms for the lifted block (and, in one column, for the neighbors that slide aside),
 * measured frames for slot targeting, and a frame loop that scrolls near the viewport's edges.
 * The layout itself does not change until the drop, so the dragged view stays mounted.
 */
export function useReorder(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const frames = useRef(new Map<string, Frame>()).current;
  const pan = useRef(new Animated.ValueXY()).current;
  const lift = useRef(new Animated.Value(0)).current;
  const shifts = useRef(new Map<string, Animated.Value>()).current;
  const responders = useRef(new Map<string, PanResponderInstance>()).current;
  const session = useRef<Session | null>(null);
  const lastDragEnd = useRef(0);
  const [drag, setDrag] = useState<DragView | null>(null);

  const shiftFor = (id: string) => {
    let value = shifts.get(id);
    if (!value) {
      value = new Animated.Value(0);
      shifts.set(id, value);
    }
    return value;
  };

  const animate = (value: Animated.Value | Animated.ValueXY, toValue: number | { x: number; y: number }) =>
    Animated.timing(value, { toValue, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: false });

  const slide = (s: Session) => {
    const { ids, gap, reduceMotion } = latest.current;
    const step = s.frame.height + gap;
    ids.forEach((id, index) => {
      if (index === s.from) return;
      const shift =
        s.to > s.from && index > s.from && index <= s.to
          ? -step
          : s.to < s.from && index >= s.to && index < s.from
            ? step
            : 0;
      if (reduceMotion) shiftFor(id).setValue(shift);
      else animate(shiftFor(id), shift).start();
    });
  };

  const tick = () => {
    const s = session.current;
    if (!s) return;
    s.raf = null;
    if (s.speed === 0) return;
    const { metrics, scrollTo } = latest.current;
    const m = metrics.current;
    const max = Math.max(0, m.contentHeight - m.height);
    const next = Math.max(0, Math.min(max, m.y + s.speed));
    if (Math.abs(next - m.y) >= 0.5) {
      m.y = next;
      scrollTo(next);
      update();
    }
    if (session.current === s && s.speed !== 0 && s.raf === null) s.raf = requestAnimationFrame(tick);
  };

  function update() {
    const s = session.current;
    if (!s || !s.lifted) return;
    const { axis, metrics } = latest.current;
    const tx = axis === "y" ? 0 : s.dx;
    const ty = s.dy + (metrics.current.y - s.startScroll);
    pan.setValue({ x: tx, y: ty });
    const to = slotAt({ x: s.frame.x + s.frame.width / 2 + tx, y: s.frame.y + s.frame.height / 2 + ty }, s.frames);
    if (to >= 0 && to !== s.to) {
      s.to = to;
      if (axis === "y") slide(s);
      setDrag({ id: s.id, from: s.from, to, origin: s.frame, landing: landingFrame(s, axis, to) });
    }
    const viewport = s.viewport;
    if (viewport) {
      const above = viewport.top + EDGE - s.pageY;
      const below = s.pageY - (viewport.top + viewport.height - EDGE);
      const depth = above > 0 ? -Math.min(1, above / EDGE) : below > 0 ? Math.min(1, below / EDGE) : 0;
      s.speed = depth === 0 ? 0 : Math.sign(depth) * Math.max(2, MAX_SPEED * depth * depth);
      if (s.speed !== 0 && s.raf === null) s.raf = requestAnimationFrame(tick);
    }
  }

  const start = (id: string, gesture: PanResponderGestureState) => {
    const { ids, metrics, measureViewport } = latest.current;
    const measured = ids.map((key) => frames.get(key));
    const from = ids.indexOf(id);
    if (from < 0 || measured.some((frame) => !frame)) {
      session.current = null;
      return;
    }
    session.current = {
      id,
      from,
      to: from,
      frame: measured[from] as Frame,
      frames: measured as Frame[],
      startScroll: metrics.current.y,
      dx: 0,
      dy: 0,
      pageY: gesture.y0,
      lifted: false,
      viewport: null,
      speed: 0,
      raf: null,
    };
    measureViewport((top, height) => {
      if (session.current?.id === id) session.current.viewport = { top, height };
    });
  };

  const move = (gesture: PanResponderGestureState) => {
    const s = session.current;
    if (!s) return;
    s.dx = gesture.dx;
    s.dy = gesture.dy;
    s.pageY = gesture.moveY;
    if (!s.lifted) {
      if (Math.hypot(gesture.dx, gesture.dy) < DRAG_SLOP) return;
      s.lifted = true;
      setDrag({ id: s.id, from: s.from, to: s.from, origin: s.frame, landing: s.frame });
      if (latest.current.reduceMotion) lift.setValue(1);
      else Animated.spring(lift, { toValue: 1, speed: 40, bounciness: 0, useNativeDriver: false }).start();
    }
    update();
  };

  const end = (cancelled: boolean) => {
    const s = session.current;
    session.current = null;
    if (!s) return;
    if (s.raf !== null) cancelAnimationFrame(s.raf);
    const { axis, reduceMotion, onDrop, onTap } = latest.current;
    if (!s.lifted) {
      if (!cancelled && Platform.OS !== "web") onTap(s.id);
      return;
    }
    lastDragEnd.current = Date.now();
    const to = cancelled ? s.from : s.to;
    const landing = landingFrame(s, axis, to);
    const finish = () => {
      if (to !== s.from) onDrop(s.from, to);
      setDrag(null);
    };
    if (cancelled && axis === "y") {
      s.to = s.from;
      slide(s);
    }
    if (reduceMotion) {
      finish();
      return;
    }
    Animated.parallel([
      animate(pan, { x: landing.x - s.frame.x, y: landing.y - s.frame.y }),
      animate(lift, 0),
    ]).start(finish);
  };

  // After the drop re-renders the new order, clear the transforms before the frame is painted.
  useLayoutEffect(() => {
    if (drag !== null) return;
    pan.setValue({ x: 0, y: 0 });
    lift.setValue(0);
    shifts.forEach((value) => value.setValue(0));
  }, [drag, pan, lift, shifts]);

  /** Stable handlers per block: a gesture keeps its state across re-renders. */
  const gripHandlers = (id: string): GestureResponderHandlers => {
    let responder = responders.get(id);
    if (!responder) {
      responder = PanResponder.create({
        // Claim the touch at once, so a drag that starts on the grip never scrolls the page.
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponderCapture: () => true,
        onPanResponderGrant: (_event, gesture) => start(id, gesture),
        onPanResponderMove: (_event, gesture) => move(gesture),
        onPanResponderRelease: () => end(false),
        onPanResponderTerminate: () => end(true),
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      });
      responders.set(id, responder);
    }
    return responder.panHandlers;
  };

  const lifted = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] });

  return {
    drag,
    gripHandlers,
    /** Measure each block; frames are relative to the container that holds them all. */
    onCellLayout: (id: string) => (event: LayoutChangeEvent) => {
      const { x, y, width, height } = event.nativeEvent.layout;
      frames.set(id, { x, y, width, height });
    },
    /** The transform for a block while something is lifted; null otherwise. */
    cellTransform(id: string) {
      if (!drag) return null;
      if (drag.id === id) {
        return { zIndex: 10, transform: [{ translateX: pan.x }, { translateY: pan.y }, { scale: lifted }] };
      }
      return latest.current.axis === "y" ? { transform: [{ translateY: shiftFor(id) }] } : null;
    },
    /** Keeps the lifted block under the pointer when the page scrolls under it. */
    onScroll: update,
    /** True for the click a browser sends right after a drag ends on the grip. */
    isClickAfterDrag: () => Date.now() - lastDragEnd.current < 400,
  };
}

/**
 * The drag handle. It is also a button: pressing it (Enter, Space, click, or tap) opens the Move
 * buttons, and screen readers get Move up and Move down as actions.
 */
export function Grip({
  name,
  open,
  disabled,
  handlers,
  onPress,
  onMove,
  theme,
  styles,
}: {
  name: string;
  /** The Move buttons are showing. */
  open: boolean;
  disabled: boolean;
  handlers: GestureResponderHandlers;
  onPress(): void;
  onMove(delta: -1 | 1): void;
  theme: PluginTheme;
  styles: Styles;
}) {
  return (
    <View
      {...(disabled ? null : handlers)}
      // Web: keep a touch on the grip from panning the page, and a mouse drag from selecting text.
      style={Platform.OS === "web" ? ({ touchAction: "none", userSelect: "none", cursor: disabled ? "auto" : "grab" } as object) : null}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Reorder ${name}`}
        accessibilityHint="Drag to move, or press for Move up and Move down"
        accessibilityState={{ expanded: open, disabled }}
        aria-expanded={open}
        disabled={disabled}
        accessibilityActions={[
          { name: "moveUp", label: "Move up" },
          { name: "moveDown", label: "Move down" },
        ]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "moveUp") onMove(-1);
          if (event.nativeEvent.actionName === "moveDown") onMove(1);
        }}
        onPress={onPress}
        style={({ pressed }) => [styles.headerButton, { opacity: disabled ? 0.3 : pressed ? 0.6 : 1 }]}
      >
        {open ? <Tint color={theme.colors.foreground} opacity={0.08} /> : null}
        <View>
          <Icon name="GripVertical" size={18} color={theme.colors.foregroundMuted} />
        </View>
      </Pressable>
    </View>
  );
}

/** Move up, Move down, and Done: the keyboard and screen reader path for reordering. */
export function MoveStrip({
  name,
  index,
  count,
  onMove,
  onDone,
  upRef,
  downRef,
  theme,
  styles,
}: {
  name: string;
  index: number;
  count: number;
  onMove(delta: -1 | 1): void;
  onDone(): void;
  upRef: React.Ref<View>;
  downRef: React.Ref<View>;
  theme: PluginTheme;
  styles: Styles;
}) {
  const button = (label: string, icon: string, onPress: () => void, disabled: boolean, accessibilityLabel: string, ref?: React.Ref<View>) => (
    <Pressable
      ref={ref}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.pillTarget, { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}
    >
      <View style={[styles.pill, { height: 32 }]}>
        <Tint color={theme.colors.foreground} opacity={0.07} />
        <Icon name={icon} size={14} color={theme.colors.foreground} />
        <Text style={styles.pillText}>{label}</Text>
      </View>
    </Pressable>
  );
  return (
    <View
      style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: space.sm, minHeight: TOUCH }}
      accessibilityLabel={`Move ${name}`}
    >
      <Text style={[styles.subtle, { marginRight: space.xs }]}>{`Position ${index + 1} of ${count}`}</Text>
      {button("Move up", "ArrowUp", () => onMove(-1), index === 0, `Move ${name} up`, upRef)}
      {button("Move down", "ArrowDown", () => onMove(1), index === count - 1, `Move ${name} down`, downRef)}
      {button("Done", "Check", onDone, false, `Done moving ${name}`)}
    </View>
  );
}
