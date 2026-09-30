/**
 * EnhancedNarrativeSpace — 3D react-three-fiber version
 * Renders scene clusters in 3D space with centroid trajectory.
 * Lazy-loaded to avoid bundle impact for Standard mode users.
 */
import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text, Billboard, Line } from "@react-three/drei";
import type { FountainParseResult } from "@/lib/fountain-parser";

interface Props {
  parsed: FountainParseResult;
}

const ACT_COLORS_HEX: Record<number, string> = {
  1: "#6366f1",
  2: "#f59e0b",
  3: "#ef4444",
};

function classifyAct(index: number, total: number): 1 | 2 | 3 {
  const ratio = index / Math.max(total - 1, 1);
  if (ratio < 0.25) return 1;
  if (ratio < 0.75) return 2;
  return 3;
}

interface SceneNode {
  index: number;
  position: [number, number, number];
  act: 1 | 2 | 3;
  charCount: number;
  heading: string;
}

function ScenePoint({ node }: { node: SceneNode }) {
  const color = ACT_COLORS_HEX[node.act];
  const scale = 0.08 + node.charCount * 0.03;

  return (
    <group position={node.position}>
      <mesh>
        <sphereGeometry args={[scale, 12, 12]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.4} transparent opacity={0.7} />
      </mesh>
      <Billboard>
        <Text
          position={[0, scale + 0.12, 0]}
          fontSize={0.1}
          color="#a1a1aa"
          anchorX="center"
          anchorY="bottom"
          font={undefined}
        >
          {String(node.index + 1)}
        </Text>
      </Billboard>
    </group>
  );
}

function Scene3D({ parsed }: Props) {
  const { scenes, elements } = parsed;

  const sceneNodes = useMemo<SceneNode[]>(() => {
    return scenes.map((scene, idx) => {
      const nextElIdx = idx < scenes.length - 1 ? scenes[idx + 1].elementIndex : elements.length;
      const sceneEls = elements.slice(scene.elementIndex, nextElIdx);
      const total = sceneEls.length || 1;
      const dialogueDensity = sceneEls.filter(e => e.type === "dialogue").length / total;
      const actionDensity = sceneEls.filter(e => e.type === "action").length / total;
      const charCount = new Set(sceneEls.filter(e => e.type === "character").map(e => e.text.replace(/\s*\(.*\)$/, "").trim())).size;
      const act = classifyAct(idx, scenes.length);

      // Map to 3D space: x = dialogue, y = action, z = scene progression
      return {
        index: idx,
        position: [
          (dialogueDensity - 0.3) * 6,
          (actionDensity - 0.3) * 4,
          (idx / Math.max(scenes.length - 1, 1) - 0.5) * 8,
        ] as [number, number, number],
        act,
        charCount,
        heading: scene.heading,
      };
    });
  }, [scenes, elements]);

  const centroids = useMemo(() => {
    return [1, 2, 3].map(act => {
      const group = sceneNodes.filter(n => n.act === act);
      if (group.length === 0) return null;
      return {
        act,
        position: [
          group.reduce((s, n) => s + n.position[0], 0) / group.length,
          group.reduce((s, n) => s + n.position[1], 0) / group.length,
          group.reduce((s, n) => s + n.position[2], 0) / group.length,
        ] as [number, number, number],
      };
    }).filter(Boolean) as { act: number; position: [number, number, number] }[];
  }, [sceneNodes]);

  const trajectoryPoints = useMemo(() => centroids.map(c => c.position), [centroids]);

  return (
    <>
      <ambientLight intensity={0.3} />
      <pointLight position={[5, 5, 5]} intensity={0.6} />
      <pointLight position={[-3, -2, -3]} intensity={0.3} color="#6366f1" />

      {sceneNodes.map(node => (
        <ScenePoint key={node.index} node={node} />
      ))}

      {/* Centroid markers */}
      {centroids.map(c => (
        <group key={c.act} position={c.position}>
          <mesh>
            <octahedronGeometry args={[0.15]} />
            <meshStandardMaterial color={ACT_COLORS_HEX[c.act]} wireframe transparent opacity={0.6} />
          </mesh>
          <Billboard>
            <Text
              position={[0, 0.3, 0]}
              fontSize={0.15}
              color={ACT_COLORS_HEX[c.act]}
              anchorX="center"
              font={undefined}
              fontWeight={700}
            >
              Act {c.act}
            </Text>
          </Billboard>
        </group>
      ))}

      {/* Trajectory line */}
      {trajectoryPoints.length >= 2 && (
        <Line
          points={trajectoryPoints}
          color="#ffffff"
          lineWidth={1.5}
          dashed
          dashScale={2}
          dashSize={0.3}
          gapSize={0.15}
          opacity={0.4}
          transparent
        />
      )}

      <OrbitControls enablePan autoRotate autoRotateSpeed={0.3} />
    </>
  );
}

export default function EnhancedNarrativeSpace({ parsed }: Props) {
  if (parsed.scenes.length < 3) {
    return <div className="text-xs text-muted-foreground text-center py-8 font-mono">Not enough scenes for 3D embedding.</div>;
  }

  return (
    <div className="w-full rounded-lg overflow-hidden border border-border/30 bg-background" style={{ height: 360 }}>
      <Canvas camera={{ position: [0, 3, 8], fov: 50 }} style={{ background: "transparent" }}>
        <Scene3D parsed={parsed} />
      </Canvas>
    </div>
  );
}
