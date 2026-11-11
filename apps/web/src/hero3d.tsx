import { useEffect, useRef } from 'react';
import * as THREE from 'three';

/**
 * Latar 3D layar masuk: bentuk geometri melayang yang berputar pelan. Dimuat malas (lazy) — tidak membebani aplikasi utama.
 * Gagal dengan tenang (tanpa console.error) bila WebGL tidak ada; berhenti saat tab tersembunyi; semua sumber daya dilepas saat ditutup.
 */
function createRenderer(): THREE.WebGLRenderer | null {
  try {
    const probe = document.createElement('canvas');
    if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return null;
    return new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'low-power' });
  } catch { return null; }
}

export default function Hero3D() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const renderer = createRenderer();
    if (!renderer) return;

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0, 11);
    scene.add(new THREE.AmbientLight(0xffffff, 0.9));
    const key = new THREE.PointLight(0x818cf8, 90, 40); key.position.set(6, 6, 8); scene.add(key);
    const rim = new THREE.PointLight(0x22d3ee, 60, 40); rim.position.set(-7, -4, 6); scene.add(rim);

    const geos = [new THREE.IcosahedronGeometry(1.1, 0), new THREE.OctahedronGeometry(1, 0), new THREE.TorusGeometry(0.8, 0.28, 12, 32), new THREE.TetrahedronGeometry(1.1, 0)];
    const colors = [0x6366f1, 0x8b5cf6, 0x06b6d4, 0xf472b6, 0x38bdf8];
    const mats = colors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.25, transparent: true, opacity: 0.85, flatShading: true }));
    const spots: [number, number, number, number][] = [[-5, 2.6, -2, 1], [5.2, 3, -3, 0.9], [-3.6, -3, -1, 1.2], [4.4, -2.6, -2, 1], [0.2, 4, -6, 1.4], [-7, -0.5, -5, 1.3], [7, 0.5, -5, 1.1]];
    const meshes = spots.map(([x, y, z, s], i) => {
      const m = new THREE.Mesh(geos[i % geos.length]!, mats[i % mats.length]!);
      m.position.set(x, y, z); m.scale.setScalar(s); m.rotation.set(i, i * 0.7, 0);
      scene.add(m);
      return m;
    });

    const resize = () => {
      const w = el.clientWidth || 1, h = el.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize); ro.observe(el);

    let mx = 0, my = 0;
    const onMove = (e: PointerEvent) => { mx = (e.clientX / window.innerWidth - 0.5) * 2; my = (e.clientY / window.innerHeight - 0.5) * 2; };
    window.addEventListener('pointermove', onMove, { passive: true });

    let raf = 0, last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) { last = now; return; }
      const dt = Math.min((now - last) / 1000, 0.05); last = now;
      meshes.forEach((m, i) => { m.rotation.x += dt * (0.18 + i * 0.03); m.rotation.y += dt * (0.22 + i * 0.02); m.position.y += Math.sin(now / 1400 + i) * dt * 0.25; });
      camera.position.x += (mx * 0.9 - camera.position.x) * 0.04;
      camera.position.y += (-my * 0.6 - camera.position.y) * 0.04;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); window.removeEventListener('pointermove', onMove);
      geos.forEach((g) => g.dispose()); mats.forEach((m) => m.dispose());
      renderer.dispose(); renderer.domElement.remove();
    };
  }, []);
  return <div ref={host} className="absolute inset-0" aria-hidden="true" />;
}
