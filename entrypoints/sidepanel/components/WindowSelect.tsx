import React, { useEffect, useId, useRef, useState } from "react";

import { l10n } from "../../../i18n/index";

export interface WindowSelectOption {
  id: string;
  label: string;
}

export interface WindowSelectProps {
  options: WindowSelectOption[];
  selectedId: string;
  onSelectionChange: (id: string) => void;
}

// Accessible trigger-aligned listbox popover for the History quota window.
// No external dependency: a combobox trigger keeps focus while
// aria-activedescendant tracks the active option inside the popover.
export function WindowSelect({
  options,
  selectedId,
  onSelectionChange,
}: WindowSelectProps) {
  const labelId = useId();
  const listboxId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.id === selectedId),
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

  const optionId = (index: number) =>
    `${listboxId}-option-${options[index]?.id ?? index}`;

  const openListbox = () => {
    setActiveIndex(selectedIndex);
    setOpen(true);
  };

  const closeListbox = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  };

  const choose = (index: number) => {
    const option = options[index];
    if (!option) {
      return;
    }
    setOpen(false);
    triggerRef.current?.focus();
    onSelectionChange(option.id);
  };

  // Close when the pointer lands outside the popover; the trigger regains
  // focus so keyboard users are never left without a focus context.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        closeListbox(true);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const onKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (open) {
          setActiveIndex((index) => Math.min(options.length - 1, index + 1));
        } else {
          openListbox();
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (open) {
          setActiveIndex((index) => Math.max(0, index - 1));
        } else {
          openListbox();
        }
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (open) {
          choose(activeIndex);
        } else {
          openListbox();
        }
        break;
      case "Escape":
        if (open) {
          event.preventDefault();
          closeListbox(true);
        }
        break;
      case "Tab":
        if (open) {
          closeListbox(false);
        }
        break;
      case "Home":
        if (open) {
          event.preventDefault();
          setActiveIndex(0);
        }
        break;
      case "End":
        if (open) {
          event.preventDefault();
          setActiveIndex(options.length - 1);
        }
        break;
    }
  };

  return (
    <div
      className="compact-select window-select"
      ref={containerRef}
      onKeyDown={onKeyDown}
    >
      <span id={labelId}>{l10n.t("common.window")}</span>
      <div className="window-select__control">
        <button
          ref={triggerRef}
          type="button"
          className="window-select__trigger"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-labelledby={labelId}
          aria-activedescendant={open ? optionId(activeIndex) : undefined}
          onClick={() => (open ? closeListbox(false) : openListbox())}
        >
          <span className="window-select__value">
            {options[selectedIndex]?.label ?? ""}
          </span>
          <span className="window-select__chevron" aria-hidden="true">
            ▾
          </span>
        </button>
        {open ? (
          <ul
            className="window-select__listbox"
            role="listbox"
            id={listboxId}
            aria-labelledby={labelId}
          >
            {options.map((option, index) => (
              <li
                key={option.id}
                id={optionId(index)}
                role="option"
                aria-selected={option.id === selectedId}
                className={`window-select__option${
                  index === activeIndex ? " window-select__option--active" : ""
                }`}
                onMouseMove={() => setActiveIndex(index)}
                onClick={() => choose(index)}
              >
                {option.label}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
