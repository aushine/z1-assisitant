import { Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  ChartOptions,
} from 'chart.js'

ChartJS.register(ArcElement, Tooltip, Legend)

interface DoughnutCardProps {
  data: { label: string; value: number; color: string }[]
  height?: number
}

export function DoughnutCard({ data, height = 260 }: DoughnutCardProps) {
  const total = data.reduce((s, d) => s + d.value, 0)

  const options: ChartOptions<'doughnut'> = {
    cutout: '60%',
    plugins: {
      legend: {
        position: 'right',
        labels: {
          padding: 16,
          usePointStyle: true,
          pointStyle: 'circle',
        },
      },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const pct = total > 0 ? Math.round((ctx.parsed / total) * 100) : 0
            return `${ctx.label}: ¥${ctx.parsed.toFixed(2)} (${pct}%)`
          },
        },
      },
    },
    responsive: true,
    maintainAspectRatio: false,
  }

  return (
    <div style={{ height }}>
      <Doughnut
        data={{
          labels: data.map((d) => d.label),
          datasets: [
            {
              data: data.map((d) => d.value),
              backgroundColor: data.map((d) => d.color),
              borderColor: '#FFF',
              borderWidth: 3,
              hoverOffset: 8,
            },
          ],
        }}
        options={options}
      />
    </div>
  )
}
