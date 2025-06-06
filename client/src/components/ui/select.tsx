import * as React from "react"
import { cn } from "@/lib/utils"

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  onValueChange?: (value: string) => void
}

interface SelectItemProps {
  value: string
  children: React.ReactNode
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, onValueChange, onChange, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      onChange?.(e)
      onValueChange?.(e.target.value)
    }

    return (
      <select
        ref={ref}
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        onChange={handleChange}
        {...props}
      />
    )
  }
)

const SelectItem: React.FC<SelectItemProps> = ({ value, children }) => {
  return React.createElement("option", { value }, children)
}

const SelectTrigger = Select
const SelectValue: React.FC<{ placeholder?: string }> = () => null
const SelectContent: React.FC<{ children: React.ReactNode }> = ({ children }) => React.createElement(React.Fragment, {}, children)
const SelectGroup: React.FC<{ children: React.ReactNode }> = ({ children }) => React.createElement(React.Fragment, {}, children)

Select.displayName = "Select"
SelectTrigger.displayName = "SelectTrigger"
SelectValue.displayName = "SelectValue"
SelectContent.displayName = "SelectContent"
SelectItem.displayName = "SelectItem"
SelectGroup.displayName = "SelectGroup"

export {
  Select,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
}