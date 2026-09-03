import {
  cloneElement,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ComponentType,
  type CSSProperties,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";

/** Host element a popup may portal into. `null` means the default overlay root. */
export type PortalContainer = HTMLElement | null;

type Rest = Record<string, unknown>;
type RenderFn<P> = (props: P) => ReactNode;
type RenderProp<P> = ReactElement | RenderFn<P>;

const EXTRA_KEYS = [
  "variant",
  "tone",
  "size",
  "shape",
  "loading",
  "options",
  "disablePointerDismissal",
  "onOpenChange",
  "onOpenChangeComplete",
  "onValueChange",
  "onCheckedChange",
  "render",
  "renderValue",
  "asChild",
  "content",
  "container",
  "collisionPadding",
  "align",
  "side",
  "sideOffset",
  "positionMethod",
  "appearance",
  "layout",
  "label",
  "description",
  "error",
  "tabs",
  "bold",
  "as",
  "DANGEROUS_className",
  "open",
  "defaultOpen",
  "indeterminate",
  "icon",
  "modal",
  "portal",
  "keepMounted",
  "tag",
] as const;

const EXTRA = new Set<string>(EXTRA_KEYS);

function omitExtra(props: Rest): Rest {
  const out: Rest = {};
  for (const [key, value] of Object.entries(props)) {
    if (!EXTRA.has(key)) out[key] = value;
  }
  return out;
}

function mergeHandlers<E>(a?: (event: E) => void, b?: (event: E) => void) {
  if (!a) return b;
  if (!b) return a;
  return (event: E) => {
    a(event);
    b(event);
  };
}

function applyRender<P extends { children?: ReactNode }>(
  render: RenderProp<P> | undefined,
  props: P,
  fallback: (props: P) => ReactNode,
): ReactNode {
  if (typeof render === "function") return render(props);
  if (isValidElement(render)) {
    const element = render as ReactElement<{
      onClick?: (event: MouseEvent<HTMLElement>) => void;
      disabled?: boolean;
      children?: ReactNode;
    }>;
    const extra = props as {
      onClick?: (event: MouseEvent<HTMLElement>) => void;
      disabled?: boolean;
      children?: ReactNode;
    };
    return cloneElement(element, {
      ...extra,
      onClick: mergeHandlers(element.props.onClick, extra.onClick),
      disabled: element.props.disabled || extra.disabled,
      children: element.props.children ?? extra.children,
    });
  }
  return fallback(props);
}

type Loose = Rest & {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  render?: RenderProp<Rest>;
};

function Fallback({ children, render, className, style, ...rest }: Loose) {
  const dom = omitExtra(rest);
  const props = { className, style, ...dom, children };
  return applyRender(render, props, (p) => (
    <div {...(omitExtra(p as Rest) as HTMLAttributes<HTMLDivElement>)}>{p.children}</div>
  ));
}

type Compound<P, Known extends Record<string, ComponentType<any>>> = ComponentType<P> &
  Known &
  Record<string, ComponentType<Loose>>;

function asCompound<P, Known extends Record<string, ComponentType<any>>>(
  root: ComponentType<P>,
  known: Known,
): Compound<P, Known> {
  Object.assign(root, known);
  const cache = new Map<string, ComponentType<Loose>>();
  return new Proxy(root as object, {
    get(target, prop, receiver) {
      if (typeof prop !== "string" || prop in (target as object)) {
        return Reflect.get(target, prop, receiver);
      }
      let fallback = cache.get(prop);
      if (!fallback) {
        const Comp = (props: Loose) => <Fallback {...props} />;
        Comp.displayName = prop;
        cache.set(prop, Comp);
        fallback = Comp;
      }
      return fallback;
    },
  }) as Compound<P, Known>;
}

function FieldChrome({
  label,
  description,
  error,
  children,
}: {
  label?: ReactNode;
  description?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  if (label == null && description == null && error == null) return children;
  return (
    <div>
      {label != null && <div>{label}</div>}
      {children}
      {description != null && <div>{description}</div>}
      {error != null && <div>{error}</div>}
    </div>
  );
}

export function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    tone?: string;
    size?: string;
    shape?: string;
    loading?: boolean;
  } & Rest,
) {
  const { variant: _v, tone: _t, size: _s, shape: _sh, loading, children, disabled, type, ...rest } = props;
  return (
    <button
      type={type ?? "button"}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...(omitExtra(rest as Rest) as ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {children}
    </button>
  );
}

export function Input(
  props: InputHTMLAttributes<HTMLInputElement> & {
    label?: ReactNode;
    description?: ReactNode;
    error?: ReactNode;
    variant?: string;
    onValueChange?: (value: string) => void;
  } & Rest,
) {
  const { label, description, error, variant: _v, onValueChange, onChange, ...rest } = props;
  return (
    <FieldChrome label={label} description={description} error={error}>
      <input
        onChange={(event) => {
          onChange?.(event);
          onValueChange?.(event.target.value);
        }}
        {...(omitExtra(rest as Rest) as InputHTMLAttributes<HTMLInputElement>)}
      />
    </FieldChrome>
  );
}

export function SensitiveInput(
  props: InputHTMLAttributes<HTMLInputElement> & {
    label?: ReactNode;
    description?: ReactNode;
    error?: ReactNode;
    variant?: string;
    onValueChange?: (value: string) => void;
  } & Rest,
) {
  const { label, description, error, variant: _v, onValueChange, onChange, type: _type, ...rest } = props;
  return (
    <FieldChrome label={label} description={description} error={error}>
      <input
        type="password"
        onChange={(event) => {
          onChange?.(event);
          onValueChange?.(event.target.value);
        }}
        {...(omitExtra(rest as Rest) as InputHTMLAttributes<HTMLInputElement>)}
      />
    </FieldChrome>
  );
}

export function Textarea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement> & {
    label?: ReactNode;
    description?: ReactNode;
    error?: ReactNode;
    onValueChange?: (value: string) => void;
  } & Rest,
) {
  const { label, description, error, onValueChange, onChange, ...rest } = props;
  return (
    <FieldChrome label={label} description={description} error={error}>
      <textarea
        onChange={(event) => {
          onChange?.(event);
          onValueChange?.(event.target.value);
        }}
        {...(omitExtra(rest as Rest) as TextareaHTMLAttributes<HTMLTextAreaElement>)}
      />
    </FieldChrome>
  );
}

export function InputArea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement> & {
    label?: ReactNode;
    description?: ReactNode;
    error?: ReactNode;
    onValueChange?: (value: string) => void;
  } & Rest,
) {
  return <Textarea {...props} />;
}

export function Switch(
  props: {
    checked?: boolean;
    disabled?: boolean;
    size?: string;
    onCheckedChange?: (checked: boolean) => void;
    onChange?: (checked: boolean) => void;
  } & Omit<HTMLAttributes<HTMLButtonElement>, "onChange"> &
    Rest,
) {
  const { checked, onCheckedChange, onChange, size: _s, ...rest } = props;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        const next = !checked;
        onCheckedChange?.(next);
        onChange?.(next);
      }}
      {...(omitExtra(rest as Rest) as HTMLAttributes<HTMLButtonElement>)}
    />
  );
}

export function Checkbox(
  props: {
    checked?: boolean;
    label?: ReactNode;
    onCheckedChange?: (checked: boolean) => void;
    onChange?: (checked: boolean) => void;
  } & Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> &
    Rest,
) {
  const { checked, label, onCheckedChange, onChange, children, ...rest } = props;
  const input = (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => {
        onCheckedChange?.(event.target.checked);
        onChange?.(event.target.checked);
      }}
      {...(omitExtra(rest as Rest) as InputHTMLAttributes<HTMLInputElement>)}
    />
  );
  if (label == null && children == null) return input;
  return (
    <label>
      {input}
      {label}
      {children}
    </label>
  );
}

type RadioCtx = {
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  name: string;
};

const RadioContext = createContext<RadioCtx>({ name: "kumo-radio" });

function RadioInput(props: InputHTMLAttributes<HTMLInputElement> & Rest) {
  return <input type="radio" {...(omitExtra(props) as InputHTMLAttributes<HTMLInputElement>)} />;
}

function RadioGroup({
  value,
  onValueChange,
  disabled,
  appearance: _a,
  children,
  ...rest
}: {
  value?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
  appearance?: string;
  children?: ReactNode;
} & HTMLAttributes<HTMLDivElement> &
  Rest) {
  const name = useRef(`kumo-radio-${Math.random().toString(36).slice(2)}`).current;
  return (
    <RadioContext.Provider value={{ value, onValueChange, disabled, name }}>
      <div role="radiogroup" {...(omitExtra(rest as Rest) as HTMLAttributes<HTMLDivElement>)}>
        {children}
      </div>
    </RadioContext.Provider>
  );
}

function RadioLegend(props: HTMLAttributes<HTMLLegendElement> & Rest) {
  return <div {...(omitExtra(props as Rest) as HTMLAttributes<HTMLDivElement>)} />;
}

function RadioItem({
  value,
  label,
  children,
  ...rest
}: {
  value: string;
  label?: ReactNode;
  children?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement> &
  Rest) {
  const ctx = useContext(RadioContext);
  return (
    <label>
      <input
        type="radio"
        name={ctx.name}
        value={value}
        checked={ctx.value === value}
        disabled={ctx.disabled || rest.disabled}
        onChange={() => ctx.onValueChange?.(value)}
        {...(omitExtra(rest as Rest) as InputHTMLAttributes<HTMLInputElement>)}
      />
      {label}
      {children}
    </label>
  );
}

export const Radio = asCompound(RadioInput, {
  Group: RadioGroup,
  Legend: RadioLegend,
  Item: RadioItem,
});

export function Loader(props: { size?: string } & HTMLAttributes<HTMLDivElement> & Rest) {
  const { size, style, ...rest } = props;
  const px = size === "lg" ? 32 : size === "sm" ? 14 : 20;
  return (
    <div
      role="status"
      aria-label="Loading"
      style={{
        width: px,
        height: px,
        borderRadius: "50%",
        border: "2px solid var(--color-kumo-fill)",
        borderTopColor: "var(--color-kumo-brand)",
        animation: "kumo-spin 0.7s linear infinite",
        ...style,
      }}
      {...(omitExtra(rest as Rest) as HTMLAttributes<HTMLDivElement>)}
    />
  );
}

export function Text({
  as: Tag = "span",
  bold,
  variant: _v,
  size: _s,
  DANGEROUS_className,
  className,
  children,
  ...rest
}: {
  as?: keyof HTMLElementTagNameMap;
  bold?: boolean;
  variant?: string;
  size?: string;
  DANGEROUS_className?: string;
  className?: string;
  children?: ReactNode;
} & Rest) {
  const Component = Tag as unknown as ComponentType<HTMLAttributes<HTMLElement>>;
  return (
    <Component
      className={[className, DANGEROUS_className].filter(Boolean).join(" ") || undefined}
      style={bold ? { fontWeight: 600 } : undefined}
      {...(omitExtra(rest) as HTMLAttributes<HTMLElement>)}
    >
      {children}
    </Component>
  );
}

export function Banner({
  variant: _v,
  title,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { variant?: string; title?: ReactNode } & Rest) {
  return (
    <div role="status" {...(omitExtra(rest as Rest) as HTMLAttributes<HTMLDivElement>)}>
      {title}
      {children}
    </div>
  );
}

export function Badge({
  variant: _v,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { variant?: string } & Rest) {
  return <span {...(omitExtra(rest as Rest) as HTMLAttributes<HTMLSpanElement>)}>{children}</span>;
}

function TableRoot({
  layout: _l,
  children,
  ...rest
}: { layout?: string; children?: ReactNode } & HTMLAttributes<HTMLTableElement> & Rest) {
  return <table {...(omitExtra(rest as Rest) as HTMLAttributes<HTMLTableElement>)}>{children}</table>;
}

function TableHeader(props: HTMLAttributes<HTMLTableSectionElement> & Rest) {
  return <thead {...(omitExtra(props as Rest) as HTMLAttributes<HTMLTableSectionElement>)} />;
}

function TableBody(props: HTMLAttributes<HTMLTableSectionElement> & Rest) {
  return <tbody {...(omitExtra(props as Rest) as HTMLAttributes<HTMLTableSectionElement>)} />;
}

function TableRow({
  variant: _v,
  children,
  ...rest
}: HTMLAttributes<HTMLTableRowElement> & { variant?: string } & Rest) {
  return <tr {...(omitExtra(rest as Rest) as HTMLAttributes<HTMLTableRowElement>)}>{children}</tr>;
}

function TableHead(props: HTMLAttributes<HTMLTableCellElement> & Rest) {
  return <th {...(omitExtra(props as Rest) as HTMLAttributes<HTMLTableCellElement>)} />;
}

function TableCell(props: HTMLAttributes<HTMLTableCellElement> & Rest) {
  return <td {...(omitExtra(props as Rest) as HTMLAttributes<HTMLTableCellElement>)} />;
}

function TableCheck({
  checked,
  indeterminate,
  onValueChange,
  ...rest
}: {
  checked?: boolean;
  indeterminate?: boolean;
  onValueChange?: () => void;
} & InputHTMLAttributes<HTMLInputElement>) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={() => onValueChange?.()}
      {...rest}
    />
  );
}

function TableCheckHead(
  props: {
    checked?: boolean;
    indeterminate?: boolean;
    onValueChange?: () => void;
  } & HTMLAttributes<HTMLTableCellElement> &
    Rest,
) {
  const { checked, indeterminate, onValueChange, ...rest } = props;
  return (
    <th {...(omitExtra(rest as Rest) as HTMLAttributes<HTMLTableCellElement>)}>
      <TableCheck checked={checked} indeterminate={indeterminate} onValueChange={onValueChange} />
    </th>
  );
}

function TableCheckCell(
  props: {
    checked?: boolean;
    onValueChange?: () => void;
  } & HTMLAttributes<HTMLTableCellElement> &
    Rest,
) {
  const { checked, onValueChange, ...rest } = props;
  return (
    <td {...(omitExtra(rest as Rest) as HTMLAttributes<HTMLTableCellElement>)}>
      <TableCheck checked={checked} onValueChange={onValueChange} />
    </td>
  );
}

export const Table = asCompound(TableRoot, {
  Header: TableHeader,
  Body: TableBody,
  Row: TableRow,
  Head: TableHead,
  Cell: TableCell,
  CheckHead: TableCheckHead,
  CheckCell: TableCheckCell,
});

export function Tooltip({
  children,
  content,
  asChild,
  render,
}: {
  children?: ReactNode;
  content?: ReactNode;
  asChild?: boolean;
  render?: RenderProp<HTMLAttributes<HTMLElement>>;
} & Rest) {
  const title = typeof content === "string" ? content : undefined;
  const triggerProps = { title, children };
  if (render) {
    return applyRender(render, triggerProps, (p) => <span title={title}>{p.children}</span>);
  }
  if (asChild && isValidElement(children)) {
    return cloneElement(children as ReactElement<{ title?: string }>, { title });
  }
  return <span title={title}>{children}</span>;
}

export function TooltipProvider({ children }: { children?: ReactNode } & Rest) {
  return <>{children}</>;
}

type OpenCtx = {
  open: boolean;
  setOpen: (open: boolean) => void;
  disablePointerDismissal?: boolean;
  role?: string;
};

const DialogContext = createContext<OpenCtx>({ open: true, setOpen: () => {} });

function DialogRoot({
  open,
  onOpenChange,
  onOpenChangeComplete,
  disablePointerDismissal,
  role,
  children,
  ...rest
}: {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onOpenChangeComplete?: (open: boolean) => void;
  disablePointerDismissal?: boolean;
  role?: string;
  children?: ReactNode;
} & Rest) {
  const [inner, setInner] = useState(open ?? false);
  const isOpen = open ?? inner;
  const setOpen = (next: boolean) => {
    setInner(next);
    onOpenChange?.(next);
  };
  const seenOpen = useRef<boolean | undefined>(undefined);
  useEffect(() => {
    if (seenOpen.current === undefined) {
      seenOpen.current = isOpen;
      return;
    }
    if (seenOpen.current === isOpen) return;
    seenOpen.current = isOpen;
    onOpenChangeComplete?.(isOpen);
  }, [isOpen, onOpenChangeComplete]);
  return (
    <DialogContext.Provider value={{ open: isOpen, setOpen, disablePointerDismissal, role }}>
      <div {...(omitExtra(rest) as HTMLAttributes<HTMLDivElement>)}>{children}</div>
    </DialogContext.Provider>
  );
}

function DialogPanel({
  size: _s,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { size?: string } & Rest) {
  const { open, setOpen, disablePointerDismissal, role } = useContext(DialogContext);
  if (!open) return null;
  return (
    <>
      <div
        aria-hidden
        onClick={() => {
          if (!disablePointerDismissal) setOpen(false);
        }}
        style={{ position: "fixed", inset: 0, zIndex: 999, background: "transparent" }}
      />
      <div
        role={role ?? "dialog"}
        aria-modal="true"
        {...(omitExtra(rest as Rest) as HTMLAttributes<HTMLDivElement>)}
        style={{
          position: "fixed",
          zIndex: 1000,
          ...(rest.style as CSSProperties | undefined),
        }}
      >
        {children}
      </div>
    </>
  );
}

function DialogTitle(props: HTMLAttributes<HTMLHeadingElement> & Rest) {
  return <h2 {...(omitExtra(props as Rest) as HTMLAttributes<HTMLHeadingElement>)} />;
}

function DialogDescription(props: HTMLAttributes<HTMLParagraphElement> & Rest) {
  return <p {...(omitExtra(props as Rest) as HTMLAttributes<HTMLParagraphElement>)} />;
}

function DialogClose(
  props: {
    render?: RenderProp<ButtonHTMLAttributes<HTMLButtonElement>>;
    children?: ReactNode;
  } & ButtonHTMLAttributes<HTMLButtonElement> &
    Rest,
) {
  const { setOpen } = useContext(DialogContext);
  const { render, onClick, children, ...rest } = props;
  const merged = {
    type: "button" as const,
    ...omitExtra(rest as Rest),
    children,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      setOpen(false);
    },
  };
  return applyRender(render, merged, (p) => (
    <button {...(p as ButtonHTMLAttributes<HTMLButtonElement>)} />
  ));
}

function DialogTrigger(
  props: {
    render?: RenderProp<ButtonHTMLAttributes<HTMLButtonElement>>;
    children?: ReactNode;
  } & ButtonHTMLAttributes<HTMLButtonElement> &
    Rest,
) {
  const { setOpen } = useContext(DialogContext);
  const { render, onClick, children, ...rest } = props;
  const merged = {
    type: "button" as const,
    ...omitExtra(rest as Rest),
    children,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      setOpen(true);
    },
  };
  return applyRender(render, merged, (p) => (
    <button {...(p as ButtonHTMLAttributes<HTMLButtonElement>)} />
  ));
}

function DialogHeader(props: HTMLAttributes<HTMLElement> & Rest) {
  return <header {...(omitExtra(props as Rest) as HTMLAttributes<HTMLElement>)} />;
}

function DialogFooter(props: HTMLAttributes<HTMLElement> & Rest) {
  return <footer {...(omitExtra(props as Rest) as HTMLAttributes<HTMLElement>)} />;
}

function DialogBody(props: HTMLAttributes<HTMLDivElement> & Rest) {
  return <div {...(omitExtra(props as Rest) as HTMLAttributes<HTMLDivElement>)} />;
}

function DialogActions(props: HTMLAttributes<HTMLDivElement> & Rest) {
  return <div {...(omitExtra(props as Rest) as HTMLAttributes<HTMLDivElement>)} />;
}

export const Dialog = asCompound(DialogPanel, {
  Root: DialogRoot,
  Title: DialogTitle,
  Description: DialogDescription,
  Close: DialogClose,
  Trigger: DialogTrigger,
  Content: DialogPanel,
  Header: DialogHeader,
  Footer: DialogFooter,
  Body: DialogBody,
  Actions: DialogActions,
});

const PopupContext = createContext<OpenCtx>({ open: false, setOpen: () => {} });

function PopupRoot({
  open,
  onOpenChange,
  children,
  ...rest
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
} & HTMLAttributes<HTMLDivElement> &
  Rest) {
  const [inner, setInner] = useState(open ?? false);
  const isOpen = open ?? inner;
  const setOpen = (next: boolean) => {
    setInner(next);
    onOpenChange?.(next);
  };
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isOpen) return;
    const onDoc = (event: Event) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [isOpen]);
  return (
    <PopupContext.Provider value={{ open: isOpen, setOpen }}>
      <div ref={ref} style={{ position: "relative", display: "inline-block" }} {...(omitExtra(rest as Rest) as HTMLAttributes<HTMLDivElement>)}>
        {children}
      </div>
    </PopupContext.Provider>
  );
}

function PopupTrigger(
  props: {
    render?: RenderProp<ButtonHTMLAttributes<HTMLButtonElement>>;
    children?: ReactNode;
    disabled?: boolean;
  } & ButtonHTMLAttributes<HTMLButtonElement> &
    Rest,
) {
  const { open, setOpen } = useContext(PopupContext);
  const { render, onClick, children, disabled, ...rest } = props;
  const merged = {
    type: "button" as const,
    disabled,
    "data-popup-open": open ? "" : undefined,
    ...omitExtra(rest as Rest),
    children,
    onClick: (event: MouseEvent<HTMLButtonElement>) => {
      onClick?.(event);
      if (!disabled) setOpen(!open);
    },
  };
  return applyRender(render, merged, (p) => (
    <button {...(p as ButtonHTMLAttributes<HTMLButtonElement>)} />
  ));
}

function PopupContent({
  children,
  container: _c,
  collisionPadding: _p,
  align: _a,
  side: _side,
  sideOffset: _so,
  positionMethod: _pm,
  ...rest
}: {
  children?: ReactNode;
  container?: PortalContainer;
  collisionPadding?: number;
  align?: string;
  side?: string;
  sideOffset?: number;
  positionMethod?: string;
} & HTMLAttributes<HTMLDivElement> &
  Rest) {
  const { open } = useContext(PopupContext);
  if (!open) return null;
  return (
    <div
      role="menu"
      style={{ position: "absolute", zIndex: 1100 }}
      {...(omitExtra(rest as Rest) as HTMLAttributes<HTMLDivElement>)}
    >
      <span aria-hidden data-kumo-arrow="" />
      {children}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  variant: _v,
  disabled,
  ...rest
}: {
  children?: ReactNode;
  onClick?: () => void;
  variant?: string;
  disabled?: boolean;
} & ButtonHTMLAttributes<HTMLButtonElement> &
  Rest) {
  const { setOpen } = useContext(PopupContext);
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onClick?.();
        setOpen(false);
      }}
      {...(omitExtra(rest as Rest) as ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {children}
    </button>
  );
}

function MenuSeparator(props: HTMLAttributes<HTMLHRElement> & Rest) {
  return <hr {...(omitExtra(props as Rest) as HTMLAttributes<HTMLHRElement>)} />;
}

export const DropdownMenu = asCompound(PopupRoot, {
  Trigger: PopupTrigger,
  Content: PopupContent,
  Item: MenuItem,
  Separator: MenuSeparator,
});

type SelectCtx = {
  value?: unknown;
  onValueChange?: (value: unknown) => void;
  close: () => void;
};

const SelectContext = createContext<SelectCtx>({ close: () => {} });

function SelectControl({
  options,
  children,
  value,
  onValueChange,
  placeholder,
  label,
  error,
  renderValue,
  container: _c,
  ...rest
}: {
  options?: { value: string; label: string }[];
  children?: ReactNode;
  value?: unknown;
  onValueChange?: (value: unknown) => void;
  placeholder?: string;
  label?: ReactNode;
  error?: ReactNode;
  renderValue?: (value: unknown) => ReactNode;
  container?: PortalContainer;
} & HTMLAttributes<HTMLDivElement> &
  Rest) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (event: Event) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, [open]);
  const shown =
    value == null || value === ""
      ? placeholder
      : (renderValue?.(value) ?? String(value));
  return (
    <FieldChrome label={label} error={error}>
      <div ref={ref} style={{ position: "relative" }} {...(omitExtra(rest as Rest) as HTMLAttributes<HTMLDivElement>)}>
        <button type="button" onClick={() => setOpen((o) => !o)}>
          {shown}
        </button>
        {open && (
          <div role="listbox" style={{ position: "absolute", zIndex: 1100 }}>
            <SelectContext.Provider
              value={{
                value,
                onValueChange: (next) => {
                  onValueChange?.(next);
                  setOpen(false);
                },
                close: () => setOpen(false),
              }}
            >
              {options?.map((option) => (
                <SelectOption key={option.value} value={option.value}>
                  {option.label}
                </SelectOption>
              ))}
              {children}
            </SelectContext.Provider>
          </div>
        )}
      </div>
    </FieldChrome>
  );
}

function SelectOption({
  value,
  children,
  ...rest
}: {
  value: unknown;
  children?: ReactNode;
} & ButtonHTMLAttributes<HTMLButtonElement> &
  Rest) {
  const ctx = useContext(SelectContext);
  return (
    <button
      type="button"
      role="option"
      aria-selected={ctx.value === value}
      onClick={() => ctx.onValueChange?.(value)}
      {...(omitExtra(rest as Rest) as ButtonHTMLAttributes<HTMLButtonElement>)}
    >
      {children}
    </button>
  );
}

export const Select = asCompound(SelectControl, {
  Root: SelectControl,
  Option: SelectOption,
});

type CollapseCtx = { open: boolean; setOpen: (open: boolean) => void };
const CollapseContext = createContext<CollapseCtx>({ open: false, setOpen: () => {} });

function CollapsibleRoot({
  open,
  onOpenChange,
  children,
  ...rest
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
} & HTMLAttributes<HTMLDivElement> &
  Rest) {
  const [inner, setInner] = useState(open ?? false);
  const isOpen = open ?? inner;
  const setOpen = (next: boolean) => {
    setInner(next);
    onOpenChange?.(next);
  };
  return (
    <CollapseContext.Provider value={{ open: isOpen, setOpen }}>
      <div {...(omitExtra(rest as Rest) as HTMLAttributes<HTMLDivElement>)}>{children}</div>
    </CollapseContext.Provider>
  );
}

function CollapsibleDefaultTrigger({ children, ...rest }: HTMLAttributes<HTMLButtonElement> & Rest) {
  const { open, setOpen } = useContext(CollapseContext);
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      {...(omitExtra(rest as Rest) as HTMLAttributes<HTMLButtonElement>)}
    >
      {children}
    </button>
  );
}

function CollapsibleDefaultPanel({ children, ...rest }: HTMLAttributes<HTMLDivElement> & Rest) {
  const { open } = useContext(CollapseContext);
  if (!open) return null;
  return <div {...(omitExtra(rest as Rest) as HTMLAttributes<HTMLDivElement>)}>{children}</div>;
}

export const Collapsible = asCompound(CollapsibleRoot, {
  Root: CollapsibleRoot,
  DefaultTrigger: CollapsibleDefaultTrigger,
  DefaultPanel: CollapsibleDefaultPanel,
  Trigger: CollapsibleDefaultTrigger,
  Content: CollapsibleDefaultPanel,
});

function PopoverTitle(props: HTMLAttributes<HTMLDivElement> & Rest) {
  return <div {...(omitExtra(props as Rest) as HTMLAttributes<HTMLDivElement>)} />;
}

export const Popover = asCompound(PopupRoot, {
  Trigger: PopupTrigger,
  Content: PopupContent,
  Title: PopoverTitle,
});

function TabsRoot({
  tabs,
  value,
  onValueChange,
  variant: _v,
  children,
  ...rest
}: {
  tabs?: { value: string; label: ReactNode }[];
  value?: string;
  onValueChange?: (value: string) => void;
  variant?: string;
  children?: ReactNode;
} & HTMLAttributes<HTMLDivElement> &
  Rest) {
  return (
    <div {...(omitExtra(rest as Rest) as HTMLAttributes<HTMLDivElement>)}>
      {tabs && (
        <div role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={tab.value === value}
              onClick={() => onValueChange?.(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

export const Tabs = asCompound(TabsRoot, {});

type Toast = { title?: ReactNode; description?: ReactNode; variant?: string };

const ToastContext = createContext<{ add: (toast: Toast) => void }>({ add: () => {} });

export function useKumoToastManager() {
  return useContext(ToastContext);
}

export function Toasty({ children }: { children?: ReactNode } & Rest) {
  const [toasts, setToasts] = useState<(Toast & { id: number })[]>([]);
  const idRef = useRef(0);
  const add = useCallback((toast: Toast) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 4000);
  }, []);
  const value = useMemo(() => ({ add }), [add]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: "fixed",
          right: 16,
          bottom: 16,
          zIndex: 2000,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            data-variant={toast.variant}
            style={{
              background: "var(--color-kumo-elevated)",
              color: "var(--color-kumo-default)",
              border: "1px solid var(--color-kumo-line)",
              borderRadius: 8,
              padding: "10px 14px",
              boxShadow: "0 8px 24px var(--color-kumo-tip-shadow)",
            }}
          >
            {toast.title}
            {toast.description != null && <div>{toast.description}</div>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
