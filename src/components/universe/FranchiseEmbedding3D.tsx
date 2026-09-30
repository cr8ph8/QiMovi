/**
 * FranchiseEmbedding3D — Three.js 3D character embedding space.
 * Z-axis = sentiment score. Hover spheres, installment-colored drift lines, grid floor.
 */
import { useMemo, useRef, useState, useCallback } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Text, Html, Grid } from "@react-three/drei";
import type { EmbeddingChar } from "./FranchiseEmbeddingSpace";
import * as THREE from "three";

interface Props {
  characters: EmbeddingChar[];
  installmentLabels: string[];
}

const COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#ef4444",
  "#8b5cf6", "#3b82f6", "#ec4899", "#14b8a6",
  "#f97316", "#a855f7",
];

interface PointData {
  name: string;
  installmentIdx: number;
  installmentTitle: string;
  lineCount: number;
  avgLineLength: number;
  lexicalUniqueness: number;
  sentimentLabel?: string;
  sentimentPositive?: number;
  distinctiveness?: number;
  pos: [number, number, number];
  r: number;
  color: string;
}

function CharacterSphere({ point, isHovered, onHover, onUnhover }: {
  point: PointData;
  isHovered: boolean;
  onHover: () => void;
  onUnhover: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);

  return (
    <group position={point.pos}>
      <mesh
        ref={meshRef}
        onPointerOver={(e) => { e.stopPropagation(); onHover(); }}
        onPointerOut={onUnhover}
      >
        <sphereGeometry args={[isHovered ? point.r * 1.3 : point.r, 16, 16]} />
        <meshStandardMaterial
          color={point.color}
          transparent
          opacity={isHovered ? 1 : 0.75}
          emissive={isHovered ? point.color : "#000000"}
          emissiveIntensity={isHovered ? 0.3 : 0}
        />
      </mesh>
      {(point.r > 0.1 || isHovered) && (
        <Text
          position={[0, point.r + 0.1, 0]}
          fontSize={0.06}
          color={isHovered ? "#fff" : "#999"}
          anchorX="center"
          anchorY="bottom"
          font={undefined}
        >
          {point.name.length > 14 ? point.name.slice(0, 14) + "…" : point.name}
        </Text>
      )}
      {isHovered && (
        <Html position={[0, point.r + 0.25, 0]} center className="pointer-events-none">
          <div className="bg-popover/95 backdrop-blur border border-border rounded-lg px-3 py-2 shadow-xl whitespace-nowrap min-w-[140px]">
            <p className="text-[11px] font-mono font-semibold text-foreground">{point.name}</p>
            <p className="text-[9px] font-mono text-muted-foreground">{point.installmentTitle}</p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1 text-[9px] font-mono text-muted-foreground">
              <span>Lines: {point.lineCount}</span>
              <span>Avg: {point.avgLineLength}</span>
              <span>Uniq: {point.lexicalUniqueness}%</span>
              {point.sentimentLabel && <span className="capitalize">Sent: {point.sentimentLabel}</span>}
              {point.distinctiveness != null && <span>Dist: {point.distinctiveness}%</span>}
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

function RotatingGroup({ children }: { children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.05;
  });
  return <group ref={ref}>{children}</group>;
}

function DriftLines({ points }: { points: PointData[] }) {
  const lines = useMemo(() => {
    const charGroups = new Map<string, PointData[]>();
    for (const p of points) {
      const key = p.name.toUpperCase();
      if (!charGroups.has(key)) charGroups.set(key, []);
      charGroups.get(key)!.push(p);
    }
    return [...charGroups.values()]
      .filter((g) => g.length >= 2)
      .map((g) => g.sort((a, b) => a.installmentIdx - b.installmentIdx));
  }, [points]);

  return (
    <>
      {lines.map((group, gi) =>
        group.slice(0, -1).map((p, pi) => {
          const next = group[pi + 1];
          const positions = new Float32Array([...p.pos, ...next.pos]);
          return (
            <line key={`${gi}-${pi}`}>
              <bufferGeometry>
                <bufferAttribute
                  attach="attributes-position"
                  args={[positions, 3]}
                />
              </bufferGeometry>
              <lineBasicMaterial color={p.color} opacity={0.35} transparent linewidth={1} />
            </line>
          );
        })
      )}
    </>
  );
}

export default function FranchiseEmbedding3D({ characters }: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const points: PointData[] = useMemo(() => {
    if (characters.length === 0) return [];

    const xs = characters.map((c) => c.avgLineLength);
    const ys = characters.map((c) => c.lexicalUniqueness);
    const zs = characters.map((c) => c.sentiment?.positive ?? 50);
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);
    const minZ = Math.min(...zs); const maxZ = Math.max(...zs);
    const rx = maxX - minX || 1;
    const ry = maxY - minY || 1;
    const rz = maxZ - minZ || 1;

    return characters.map((c) => ({
      name: c.name,
      installmentIdx: c.installmentIdx,
      installmentTitle: c.installmentTitle,
      lineCount: c.lineCount,
      avgLineLength: c.avgLineLength,
      lexicalUniqueness: c.lexicalUniqueness,
      sentimentLabel: c.sentiment?.label,
      sentimentPositive: c.sentiment?.positive,
      distinctiveness: c.distinctiveness,
      pos: [
        ((c.avgLineLength - minX) / rx - 0.5) * 2,
        ((c.lexicalUniqueness - minY) / ry - 0.5) * 2,
        (((c.sentiment?.positive ?? 50) - minZ) / rz - 0.5) * 1.5,
      ] as [number, number, number],
      r: 0.05 + Math.min(c.lineCount / 200, 0.15),
      color: COLORS[c.installmentIdx % COLORS.length],
    }));
  }, [characters]);

  if (characters.length === 0) {
    return (
      <div className="flex items-center justify-center h-[360px] text-xs text-muted-foreground font-mono">
        No data for 3D embedding
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-[9px] font-mono text-muted-foreground">
        <span>X: Avg Line Length</span>
        <span>Y: Lexical Uniqueness</span>
        <span>Z: Positive Sentiment</span>
      </div>
      <div className="h-[360px] rounded-lg overflow-hidden bg-muted/10 border border-border/20">
        <Canvas camera={{ position: [0, 1.5, 3.5], fov: 50 }}>
          <ambientLight intensity={0.6} />
          <pointLight position={[5, 5, 5]} intensity={0.8} />
          <RotatingGroup>
            {/* Grid floor */}
            <Grid
              args={[4, 4]}
              position={[0, -1.2, 0]}
              cellSize={0.4}
              cellThickness={0.5}
              cellColor="#333"
              sectionSize={1}
              sectionThickness={1}
              sectionColor="#555"
              fadeDistance={6}
              fadeStrength={1}
              followCamera={false}
            />

            {/* Axis labels */}
            <Text position={[1.2, -1.15, 0]} fontSize={0.06} color="#666" anchorX="center" font={undefined}>
              Line Length →
            </Text>
            <Text position={[0, 1.2, 0]} fontSize={0.06} color="#666" anchorX="center" font={undefined}>
              ↑ Uniqueness
            </Text>
            <Text position={[0, -1.15, 0.9]} fontSize={0.06} color="#666" anchorX="center" font={undefined}>
              Sentiment →
            </Text>

            {/* Drift lines */}
            <DriftLines points={points} />

            {/* Character spheres */}
            {points.map((p, i) => (
              <CharacterSphere
                key={i}
                point={p}
                isHovered={hoveredIdx === i}
                onHover={() => setHoveredIdx(i)}
                onUnhover={() => setHoveredIdx(null)}
              />
            ))}

            {/* Centroid */}
            <mesh>
              <sphereGeometry args={[0.06, 16, 16]} />
              <meshStandardMaterial color="#6366f1" transparent opacity={0.25} />
            </mesh>
          </RotatingGroup>
          <OrbitControls enableZoom enablePan={false} />
        </Canvas>
      </div>
    </div>
  );
}
