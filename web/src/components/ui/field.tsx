import * as React from "react"

import { cn } from "@/lib/utils"

import { Input } from "./input"
import { SelectTrigger } from "./select"
import { Textarea } from "./textarea"

type FieldProps = {
  className?: string
  htmlFor?: string
  label?: React.ReactNode
  description?: React.ReactNode
  error?: React.ReactNode
  required?: boolean
  children: React.ReactNode
}

function FieldRoot({
  className,
  htmlFor,
  label,
  description,
  error,
  required = false,
  children,
}: FieldProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {label ? (
        <label htmlFor={htmlFor} className="eyebrow inline-flex items-center gap-1.5">
          <span>{label}</span>
          {required ? <span aria-hidden="true">*</span> : null}
        </label>
      ) : null}
      {children}
      {description ? (
        <p className="text-xs text-[var(--ink-soft)]">{description}</p>
      ) : null}
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

const editorialInputClassName =
  "!h-auto !rounded-none !border-0 !border-b !border-[var(--line)] !bg-transparent !px-0 !py-3 !text-sm !font-light !shadow-none placeholder:!text-[var(--ink-faint)] focus-visible:!border-[var(--ink)] focus-visible:!ring-0"

function FieldInput({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  return <Input className={cn(editorialInputClassName, className)} {...props} />
}

function FieldTextarea({
  className,
  ...props
}: React.ComponentProps<typeof Textarea>) {
  return (
    <Textarea
      className={cn(
        editorialInputClassName,
        "!min-h-24 !resize-y !leading-relaxed",
        className,
      )}
      {...props}
    />
  )
}

function FieldSelect({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectTrigger>) {
  return (
  <SelectTrigger
    className={cn(
      "!h-auto !w-full !rounded-none !border-0 !border-b !border-[var(--line)] !bg-transparent !px-0 !py-3 !text-sm !font-light !shadow-none data-[placeholder]:!text-[var(--ink-faint)] focus-visible:!border-[var(--ink)] focus-visible:!ring-0",
      className,
    )}
    {...props}
  >
    {children}
  </SelectTrigger>
  )
}

const Field = Object.assign(FieldRoot, {
  Input: FieldInput,
  Textarea: FieldTextarea,
  Select: FieldSelect,
})

export { Field, type FieldProps }
