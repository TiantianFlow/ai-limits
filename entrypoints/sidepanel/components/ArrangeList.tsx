import type { KeyboardEvent, PointerEvent } from "react";
import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { l10n } from "../../../i18n/index";
import type {
  ProviderInstanceId,
  ProviderKind,
} from "../../../domain/public-protocol";
import { moveInstanceId } from "../arrangement";
import { Icon } from "./Icon";
import { ProviderMark } from "./ProviderMark";

export interface ArrangeItem {
  instanceId: ProviderInstanceId;
  providerKind: ProviderKind;
  label: string;
  hidden: boolean;
}

export interface ArrangeListProps {
  items: ArrangeItem[];
  onReorder: (instanceIds: ProviderInstanceId[]) => void;
  onSetHidden: (instanceId: ProviderInstanceId, hidden: boolean) => void;
}

interface DragState {
  instanceId: ProviderInstanceId;
  pointerId: number;
  original: ProviderInstanceId[];
  order: ProviderInstanceId[];
  // Row midpoints in page coordinates, measured when the drag starts.
  // Measuring once keeps the drop slot stable while rows shift underneath the
  // pointer, and page coordinates keep it right if the panel scrolls.
  midpoints: Map<ProviderInstanceId, number>;
}

function sameOrder(
  left: readonly ProviderInstanceId[],
  right: readonly ProviderInstanceId[],
): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

// Providers can connect or disconnect in another window during a drag, so the
// dragged order keeps only current ids and appends any new ones.
function reconcileOrder(
  order: readonly ProviderInstanceId[],
  ids: readonly ProviderInstanceId[],
): ProviderInstanceId[] {
  const current = new Set(ids);
  const kept = order.filter((id) => current.has(id));
  const listed = new Set(kept);
  return [...kept, ...ids.filter((id) => !listed.has(id))];
}

export function ArrangeList({ items, onReorder, onSetHidden }: ArrangeListProps) {
  const hintId = useId();
  const [drag, setDrag] = useState<DragState>();
  const [announcement, setAnnouncement] = useState("");
  const rowRefs = useRef(new Map<ProviderInstanceId, HTMLLIElement>());
  const handleRefs = useRef(new Map<ProviderInstanceId, HTMLButtonElement>());
  const pendingFocus = useRef<ProviderInstanceId | undefined>(undefined);

  const ids = items.map(({ instanceId }) => instanceId);
  const order = drag ? reconcileOrder(drag.order, ids) : ids;
  const byId = new Map(items.map((item) => [item.instanceId, item]));
  const orderedItems = order.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });

  // Reordering moves the focused handle in the DOM, which drops its focus.
  useLayoutEffect(() => {
    const instanceId = pendingFocus.current;
    if (!instanceId) return;
    pendingFocus.current = undefined;
    handleRefs.current.get(instanceId)?.focus();
  });

  const announceMove = (instanceId: ProviderInstanceId, next: ProviderInstanceId[]) => {
    const item = byId.get(instanceId);
    if (!item) return;
    setAnnouncement(
      l10n.t("overview.movedTo", {
        label: item.label,
        position: next.indexOf(instanceId) + 1,
        total: next.length,
      }),
    );
  };

  const commit = (instanceId: ProviderInstanceId, next: ProviderInstanceId[]) => {
    if (sameOrder(next, ids)) return;
    pendingFocus.current = instanceId;
    announceMove(instanceId, next);
    onReorder(next);
  };

  const handleKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    instanceId: ProviderInstanceId,
  ) => {
    const offset =
      event.key === "ArrowUp"
        ? -1
        : event.key === "ArrowDown"
          ? 1
          : event.key === "Home"
            ? -ids.length
            : event.key === "End"
              ? ids.length
              : 0;
    if (!offset) return;
    event.preventDefault();
    commit(instanceId, moveInstanceId(ids, instanceId, offset));
  };

  const dragRef = useRef(drag);
  dragRef.current = drag;
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const dragPointerId = drag?.pointerId;

  // Rows re-render in their new order while dragging, which would drop pointer
  // capture on the moving handle, so the drag listens on the window instead.
  useEffect(() => {
    if (dragPointerId === undefined) return;
    const handleMove = (event: globalThis.PointerEvent) => {
      const current = dragRef.current;
      if (!current || event.pointerId !== dragPointerId) return;
      const others = reconcileOrder(current.original, idsRef.current).filter(
        (id) => id !== current.instanceId,
      );
      const slot = others.filter((id) => {
        const midpoint = current.midpoints.get(id);
        return midpoint !== undefined && event.clientY + window.scrollY > midpoint;
      }).length;
      const next = [...others];
      next.splice(slot, 0, current.instanceId);
      if (!sameOrder(next, current.order)) setDrag({ ...current, order: next });
    };
    const finish = (cancelled: boolean) => (event: globalThis.PointerEvent) => {
      const current = dragRef.current;
      if (!current || event.pointerId !== dragPointerId) return;
      setDrag(undefined);
      if (cancelled || !idsRef.current.includes(current.instanceId)) return;
      commitRef.current(
        current.instanceId,
        reconcileOrder(current.order, idsRef.current),
      );
    };
    const handleUp = finish(false);
    const handleCancel = finish(true);
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleCancel);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleCancel);
    };
  }, [dragPointerId]);

  const handlePointerDown = (
    event: PointerEvent<HTMLButtonElement>,
    instanceId: ProviderInstanceId,
  ) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    const midpoints = new Map<ProviderInstanceId, number>();
    for (const id of ids) {
      const rect = rowRefs.current.get(id)?.getBoundingClientRect();
      if (rect) midpoints.set(id, rect.top + window.scrollY + rect.height / 2);
    }
    setDrag({
      instanceId,
      pointerId: event.pointerId,
      original: ids,
      order: ids,
      midpoints,
    });
  };

  return (
    <>
      <p className="arrange-hint" id={hintId}>
        {l10n.t("overview.arrangeHint")}
      </p>
      <ol className="arrange-list">
        {orderedItems.map((item) => {
          const dragging = drag?.instanceId === item.instanceId;
          return (
            <li
              key={item.instanceId}
              ref={(element) => {
                if (element) rowRefs.current.set(item.instanceId, element);
                else rowRefs.current.delete(item.instanceId);
              }}
              className={[
                "arrange-row",
                item.hidden ? "arrange-row--hidden" : "",
                dragging ? "arrange-row--dragging" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <button
                ref={(element) => {
                  if (element) handleRefs.current.set(item.instanceId, element);
                  else handleRefs.current.delete(item.instanceId);
                }}
                className="arrange-row__handle"
                type="button"
                aria-label={l10n.t("overview.moveNamed", { label: item.label })}
                aria-describedby={hintId}
                title={l10n.t("overview.moveNamed", { label: item.label })}
                onKeyDown={(event) => handleKeyDown(event, item.instanceId)}
                onPointerDown={(event) => handlePointerDown(event, item.instanceId)}
              >
                <Icon name="grip" />
              </button>
              <ProviderMark providerId={item.providerKind} size="sm" />
              <span className="arrange-row__label">{item.label}</span>
              <label className="settings-toggle__control arrange-row__toggle">
                <input
                  type="checkbox"
                  role="switch"
                  aria-label={l10n.t("overview.showOnOverviewNamed", {
                    label: item.label,
                  })}
                  checked={!item.hidden}
                  onChange={(event) =>
                    onSetHidden(item.instanceId, !event.currentTarget.checked)
                  }
                />
                <span className="settings-toggle__track" aria-hidden="true">
                  <span />
                </span>
              </label>
            </li>
          );
        })}
      </ol>
      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>
    </>
  );
}
