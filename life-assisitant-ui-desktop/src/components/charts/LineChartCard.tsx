import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Filler,
  Tooltip,
  ChartOptions,
} from 'chart.js'

ChartJS.register(LineElement, PointElement, CategoryScale, LinearScale, Filler, Tooltip)

interface LineChartCardProps {
  data: { label: string; value: number }[]
  color?: string
  height?: number
  /**
   * 第二条对照线（可选）—— 统计 → 健康的体重 / 体温曲线用它画移动平均线。
   * ⚠️ 追加的可选 prop，不会影响既有调用点。
   */
  compare?: { label: string; value: number }[]
  compareColor?: string
}

export function LineChartCard({
  data,
  color = '#EF4444',
  height = 260,
  compare,
  compareColor = '#9CA3AF',
}: LineChartCardProps) {
  const options: ChartOptions<'line'> = {
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: '#FFFFFF',
        titleColor: '#0A1628',
        bodyColor: '#374151',
        borderColor: '#E5E7EB',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 12,
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        grid: { color: '#F3F4F6' },
        ticks: { color: '#9CA3AF' },
      },
      x: {
        grid: { display: false },
        ticks: { color: '#9CA3AF', maxRotation: 45 },
      },
    },
    responsive: true,
    maintainAspectRatio: false,
  }

  return (
    <div style={{ height }}>
      <Line
        data={{
          labels: data.map((d) => d.label),
          datasets: [
            ...(compare && compare.length > 0
              ? [
                  {
                    data: compare.map((d) => d.value),
                    borderColor: compareColor,
                    backgroundColor: 'transparent',
                    fill: false,
                    borderDash: [5, 4],
                    tension: 0.4,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                  },
                ]
              : []),
            {
              data: data.map((d) => d.value),
              borderColor: color,
              backgroundColor: color + '1A',
              fill: true,
              tension: 0.4,
              pointRadius: 3,
              pointBackgroundColor: color,
              pointBorderColor: '#FFF',
              pointBorderWidth: 2,
              pointHoverRadius: 6,
            },
          ],
        }}
        options={options}
      />
    </div>
  )
}
