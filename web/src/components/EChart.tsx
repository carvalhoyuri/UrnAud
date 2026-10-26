import { BarChart, LineChart } from 'echarts/charts'
import { AriaComponent, GridComponent, LegendComponent, MarkLineComponent, TooltipComponent } from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'
import { useTheme } from '@/lib/hooks'

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, MarkLineComponent, CanvasRenderer])

export default function EChart({ option, height, label }: { option: Record<string, unknown>; height: number; label: string }) {
  const el = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)
  const [dark] = useTheme()

  useEffect(() => {
    if (!el.current) return
    const c = echarts.init(el.current, undefined, { renderer: 'canvas' })
    chart.current = c
    const ro = new ResizeObserver(() => c.resize())
    ro.observe(el.current)
    return () => { ro.disconnect(); c.dispose() }
  }, [])

  useEffect(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const text = dark ? '#d4d4d8' : '#3f3f46'
    chart.current?.setOption(
      {
        animation: !reduce,
        textStyle: { fontFamily: 'Inter Variable, system-ui, sans-serif', color: text },
        aria: { enabled: true, label: { description: label }, decal: { show: true } },
        ...option,
      },
      { notMerge: true },
    )
  }, [option, dark, label])

  return <div ref={el} style={{ height }} role="img" aria-label={label} />
}
