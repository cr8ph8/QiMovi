/**
 * EnhancedCharacterNetwork — 3D react-three-fiber version
 * Interactive orbital view of character influence network.
 * Lazy-loaded to avoid bundle impact for Standard mode users.
 */
import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text, Billboard, Line } from "@react-three/drei";
import type { FountainParseResult } from "@/lib/fountain-parser";
import { analyzeCharacters, type CharacterProfile } from "@/lib/character";
import * as THREE from "three";

interface Props {
  parsed: FountainParseResult;
}

function buildEdges(parsed: FountainParseResult, profiles: CharacterProfile[]) {
  const { elements } = parsed;
  const pairMap = new Map<string, number>();
  let sceneChars: string[] = [];

  for (const el of elements) {
    if (el.type === "scene_heading") {
      for (let i = 0; i < sceneChars.length; i++) {
        for (let j = i + 1; j < sceneChars.length; j++) {
          const key = [sceneChars[i], sceneChars[j]].sort().join("||");
          pairMap.set(key, (pairMap.get(key) || 0) + 1);
        }
      }
      sceneChars = [];
    } else if (el.type === "character") {
      const name = el.text.replace(/\s*\(.*\)$/, "").trim();
      if (!sceneChars.includes(name)) sceneChars.push(name);
    }
  }
  // Last scene
  for (let i = 0; i < sceneChars.length; i++) {
    for (let j = i + 1; j < sceneChars.length; j++) {
      const key = [sceneChars[i], sceneChars[j]].sort().join("||");
      pairMap.set(key, (pairMap.get(key) || 0) + 1);
    }
  }

  const nameSet = new Set(profiles.map(p => p.name));
  const edges: { source: string; target: string; weight: number }[] = [];
  pairMap.forEach((w, key) => {
    const [s, t] = key.split("||");
    if (nameSet.has(s) && nameSet.has(t)) edges.push({ source: s, target: t, weight: w });
  });
  return edges.sort((a, b) => b.weight - a.weight).slice(0, 30);
}

function CharNode({ position, name, isFocal, share }: { position: [number, number, number]; name: string; isFocal: boolean; share: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const scale = isFocal ? 0.4 : 0.15 + share * 0.005;
  const color = isFocal ? "#6366f1" : "#94a3b8";

  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.3;
    }
  });

  return (
    <group position={position}>
      <mesh ref={meshRef}>
        <sphereGeometry args={[scale, 16, 16]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.6} transparent opacity={isFocal ? 0.9 : 0.7} />
      </mesh>
      <Billboard>
        <Text
          position={[0, scale + 0.2, 0]}
          fontSize={0.15}
          color="white"
          anchorX="center"
          anchorY="bottom"
          font={undefined}
        >
          {name.length > 10 ? name.slice(0, 9) + "…" : name}
        </Text>
      </Billboard>
    </group>
  );
}

function EdgeLine({ from, to, weight }: { from: [number, number, number]; to: [number, number, number]; weight: number }) {
  return (
    <Line
      points={[from, to]}
      color="#6366f1"
      lineWidth={1}
      transparent
      opacity={Math.min(0.6, 0.1 + weight * 0.08)}
    />
  );
}

function Scene({ parsed }: Props) {
  const profiles = useMemo(() => analyzeCharacters(parsed).slice(0, 12), [parsed]);
  const edges = useMemo(() => buildEdges(parsed, profiles), [parsed, profiles]);

  const positions = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    profiles.forEach((p, i) => {
      if (i === 0) {
        map.set(p.name, [0, 0, 0]);
      } else {
        const angle = (i - 1) * ((2 * Math.PI) / (profiles.length - 1));
        const radius = 2 + (1 - p.dialogueShareRatio / 100) * 1.5;
        map.set(p.name, [
          Math.cos(angle) * radius,
          (Math.random() - 0.5) * 1.5,
          Math.sin(angle) * radius,
        ]);
      }
    });
    return map;
  }, [profiles]);

  return (
    <>
      <ambientLight intensity={0.4} />
      <pointLight position={[5, 5, 5]} intensity={0.8} />
      <pointLight position={[-5, -3, -5]} intensity={0.3} color="#6366f1" />

      {edges.map((e, i) => {
        const from = positions.get(e.source);
        const to = positions.get(e.target);
        if (!from || !to) return null;
        return <EdgeLine key={i} from={from} to={to} weight={e.weight} />;
      })}

      {profiles.map((p, i) => {
        const pos = positions.get(p.name);
        if (!pos) return null;
        return <CharNode key={p.name} position={pos} name={p.name} isFocal={i === 0} share={p.dialogueShareRatio} />;
      })}

      <OrbitControls enablePan={false} autoRotate autoRotateSpeed={0.5} />
    </>
  );
}

export default function EnhancedCharacterNetwork({ parsed }: Props) {
  const profiles = useMemo(() => analyzeCharacters(parsed), [parsed]);

  if (profiles.length < 2) {
    return <div className="text-xs text-muted-foreground text-center py-8 font-mono">Not enough characters for 3D network.</div>;
  }

  return (
    <div className="w-full rounded-lg overflow-hidden border border-border/30 bg-background" style={{ height: 360 }}>
      <Canvas camera={{ position: [0, 3, 6], fov: 50 }} style={{ background: "transparent" }}>
        <Scene parsed={parsed} />
      </Canvas>
    </div>
  );
}
