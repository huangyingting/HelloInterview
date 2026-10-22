import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

type SelectProps = Pick<ButtonHTMLAttributes<HTMLButtonElement>,
  'id' | 'className' | 'disabled' | 'aria-describedby' | 'aria-invalid'> & (
  { 'aria-label': string; 'aria-labelledby'?: string } | { 'aria-label'?: string; 'aria-labelledby': string }
) & {
  value: string | number;
  options: readonly SelectOption[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  name?: string;
};

export function Select({ value, options, onValueChange, placeholder, name, id, className, disabled, ...attributes }: SelectProps) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const listId = `${controlId}-list`;
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef({ text: '', at: 0 });
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState(String(value));
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const selectedIndex = options.findIndex(option => String(option.value) === String(value));
  const enabled = options.map((option, index) => option.disabled ? -1 : index).filter(index => index >= 0);
  const unavailable = disabled || !enabled.length;
  const requestedIndex = options.findIndex(option => String(option.value) === activeValue && !option.disabled);
  const activeIndex = requestedIndex >= 0 ? requestedIndex
    : selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : enabled[0] ?? -1;
  const expanded = open && !unavailable;

  function close(restoreFocus = false) {
    setOpen(false);
    search.current = { text: '', at: 0 };
    if (restoreFocus) trigger.current?.focus();
  }

  function show(index = selectedIndex >= 0 && !options[selectedIndex].disabled ? selectedIndex : enabled[0]) {
    if (unavailable) return;
    setActiveValue(String(options[index].value));
    search.current = { text: '', at: 0 };
    setPosition(null);
    setOpen(true);
  }

  function choose(index: number, restoreFocus = true) {
    const option = options[index];
    if (!option || option.disabled) return;
    if (String(option.value) !== String(value)) onValueChange(String(option.value));
    close(restoreFocus);
  }

  useEffect(() => {
    if (unavailable) setOpen(false);
  }, [unavailable]);

  useLayoutEffect(() => {
    if (!expanded) return;
    function place() {
      if (!trigger.current) return;
      const box = trigger.current.getBoundingClientRect();
      if (box.bottom <= 0 || box.top >= window.innerHeight) { close(); return; }
      const below = window.innerHeight - box.bottom - 14;
      const above = box.top - 14;
      const upwards = below < Math.min(200, above);
      const width = Math.min(Math.max(box.width, 180), window.innerWidth - 16);
      setPosition({
        left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)),
        width,
        maxHeight: Math.max(44, Math.min(280, upwards ? above : below)),
        ...(upwards ? { bottom: window.innerHeight - box.top + 6 } : { top: box.bottom + 6 }),
      });
    }
    function outside(event: Event) {
      if (event.target instanceof Node && !trigger.current?.contains(event.target) && !list.current?.contains(event.target)) close();
    }
    function scroll(event: Event) {
      if (event.target !== list.current) place();
    }
    function blur() { close(); }
    place();
    const observer = new ResizeObserver(place);
    observer.observe(trigger.current!);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scroll, true);
    window.addEventListener('blur', blur);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', scroll, true);
      window.removeEventListener('blur', blur);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [expanded, options.length]);

  useLayoutEffect(() => {
    if (!expanded || !position || !list.current || activeIndex < 0) return;
    const option = document.getElementById(`${listId}-${activeIndex}`);
    if (!option) return;
    const box = option.getBoundingClientRect(), viewport = list.current.getBoundingClientRect();
    if (box.top < viewport.top) list.current.scrollTop -= viewport.top - box.top;
    else if (box.bottom > viewport.bottom) list.current.scrollTop += box.bottom - viewport.bottom;
  }, [activeIndex, expanded, position, listId]);

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const current = expanded ? activeIndex : selectedIndex;
    if (event.key === 'Tab') {
      if (expanded) choose(activeIndex, false);
      return;
    }
    if (event.key === 'Escape') {
      if (expanded) { event.preventDefault(); event.stopPropagation(); close(true); }
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (event.altKey && expanded && event.key === 'ArrowUp') { choose(activeIndex); return; }
      if (!expanded) show();
      else {
        const offset = event.key === 'ArrowDown' ? 1 : -1;
        const next = (enabled.indexOf(current) + offset + enabled.length) % enabled.length;
        setActiveValue(String(options[enabled[next]].value));
      }
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const next = event.key === 'Home' ? enabled[0] : enabled[enabled.length - 1];
      if (!expanded) show(next);
      else setActiveValue(String(options[next].value));
      return;
    }
    const searching = search.current.text && Date.now() - search.current.at < 700;
    if (event.key === 'Enter' || event.key === ' ' && !searching) {
      event.preventDefault();
      if (expanded) choose(activeIndex);
      else show();
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    const text = (searching ? search.current.text : '') + event.key.toLocaleLowerCase();
    search.current = { text, at: Date.now() };
    const repeated = [...text].every(character => character === text[0]);
    const prefix = repeated ? text[0] : text;
    const start = enabled.indexOf(current);
    for (let offset = repeated ? 1 : 0; offset < enabled.length + (repeated ? 1 : 0); offset++) {
      const index = enabled[(Math.max(start, 0) + offset) % enabled.length];
      if (options[index].label.toLocaleLowerCase().startsWith(prefix)) {
        setActiveValue(String(options[index].value));
        if (!expanded && String(options[index].value) !== String(value)) onValueChange(String(options[index].value));
        break;
      }
    }
  }

  return <>
    <button {...attributes} id={controlId} ref={trigger} type="button" role="combobox"
      className={`select-trigger${className ? ` ${className}` : ''}`} disabled={unavailable}
      aria-haspopup="listbox" aria-expanded={expanded} aria-controls={expanded ? listId : undefined}
      aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
      onClick={() => expanded ? close() : show()} onKeyDown={keyDown}>
      <span>{options[selectedIndex]?.label ?? placeholder ?? (options.length ? 'Select an option' : 'No options available')}</span>
      <ChevronDown size={15} aria-hidden="true"/>
    </button>
    {name && <input type="hidden" name={name} value={String(value)} disabled={unavailable}/>}
    {expanded && position && createPortal(
      <div ref={list} id={listId} role="listbox" className="select-popup" style={position}
        aria-label={attributes['aria-label']} aria-labelledby={attributes['aria-labelledby']}>
        {options.map((option, index) => <div key={option.value} id={`${listId}-${index}`}
          role="option" aria-selected={String(option.value) === String(value)} aria-disabled={option.disabled || undefined}
          data-active={index === activeIndex} className="select-option"
          onPointerDown={event => { if (event.pointerType === 'mouse') event.preventDefault(); }}
          onPointerMove={event => { if (event.pointerType === 'mouse' && !option.disabled) setActiveValue(String(option.value)); }}
          onClick={() => choose(index)}>
          <span>{option.label}</span>{String(option.value) === String(value) && <Check size={15} aria-hidden="true"/>}
        </div>)}
      </div>, document.body)}
  </>;
}
