import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts"

interface LoreStats {
  characterCount: number
  worldBibleAspectCount: number
  canonEventCount: number
  tropeCount: number
  materialCount: number
}

export default function LoreStatsChart({ stats }: { stats: LoreStats }) {
  const data = [
    { subject: "角色", value: stats.characterCount, fullMark: Math.max(stats.characterCount * 1.5, 10) },
    { subject: "世界观", value: stats.worldBibleAspectCount, fullMark: Math.max(stats.worldBibleAspectCount * 1.5, 10) },
    { subject: "正史", value: stats.canonEventCount, fullMark: Math.max(stats.canonEventCount * 1.5, 10) },
    { subject: "桥段", value: stats.tropeCount, fullMark: Math.max(stats.tropeCount * 1.5, 10) },
    { subject: "素材", value: stats.materialCount, fullMark: Math.max(stats.materialCount * 1.5, 10) },
  ]

  return (
    <div className="w-full h-48">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
          <PolarGrid stroke="rgba(255,255,255,0.1)" />
          <PolarAngleAxis dataKey="subject" tick={{ fill: "rgba(255,255,255,0.5)", fontSize: 12 }} />
          <PolarRadiusAxis angle={90} domain={[0, 'auto']} tick={false} axisLine={false} />
          <Radar
            name="设定数量"
            dataKey="value"
            stroke="#F59E0B"
            strokeWidth={2}
            fill="#F59E0B"
            fillOpacity={0.15}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: '#1F2937',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '8px',
              color: '#FDFBF5',
              fontSize: '12px',
            }}
            itemStyle={{ color: '#F59E0B' }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  )
}
