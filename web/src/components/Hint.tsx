import { Info } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** Ícone "i" com tooltip explicando uma métrica (também acessível por teclado). */
export function Hint({ text }: { text: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" aria-label={`Ajuda: ${text}`} className="-my-1 inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring" />}
      >
        <Info className="size-3.5" aria-hidden />
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-pretty">{text}</TooltipContent>
    </Tooltip>
  )
}
