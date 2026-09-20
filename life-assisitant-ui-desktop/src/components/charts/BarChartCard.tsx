import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  ChartOptions,
} from 'chart.js'

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip)

interface BarChartCardProps {
  data: { label: string; value: number }[]
  color?: string
  height?: number
}

export function BarChartCard({ data, color = '#014DB2', height = 260 }: BarChartCardProps) {
  const options: ChartOptions<'bar'> = {
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
      <Bar
        data={{
          labels: data.map((d) => d.label),
          datasets: [
            {
              data: data.map((d) => d.value),
              backgroundColor: color + 'B3',
              borderColor: color,
              borderWidth: 1,
              borderRadius: 4,
            },
          ],
        }}
        options={options}
      />
    </div>
  )
}
