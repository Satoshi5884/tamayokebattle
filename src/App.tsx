import { useEffect, useRef, useState } from "react";
import "./App.css";

/**
 * DodgeBlobs（でかいの来る避けゲー） + 剣（近接）
 * - 左クリック/タップで剣を振る（扇型の当たり判定）
 * - ダメージ：small=1発, big=2発, ultimate(最強 本体)=3発
 * - 当たるとGAME OVER。Spaceで再開。
 */

export default function Game() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [running, setRunning] = useState(true);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [message, setMessage] = useState("左クリック/タッチで剣！ small=1発・big=2発・最強=3発");
  const [showGameOver, setShowGameOver] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const BEST_KEY = "dodge-blobs:best";
  const SCORE_KEY = "dodge-blobs:score";

  // 自機
  const player = useRef({ x: 200, y: 200, r: 10 });
  // 入力（マウス/タッチ座標を追従させる）
  const input = useRef({ x: 200, y: 200, active: false });

  // 剣（近接）状態
  const sword = useRef({
    active: false,
    t: 0, // 残りフレーム
    cooldown: 0,
    angle: 0, // どちら向きに振るか（プレイヤー→ポインタの角度）
  });

  type BlobType = "small" | "big" | "ultimate";
  type Blob = {
    x: number;
    y: number;
    r: number; // 現在半径
    targetR: number; // 目標半径（ゆっくり拡大）
    vx: number;
    vy: number;
    type: BlobType;
    ttl: number; // 生存時間（フレーム）
    warn?: boolean; // 予兆表示（ultimateなど）
    hp?: number; // 耐久（small=1, big=2, ultimate本体=3）
    id?: number; // 同期用ID（ultimate複数本体をまとめて消すため）
  };

  const blobs = useRef<Blob[]>([]);
  const nextBlobId = useRef<number>(1);
  const raf = useRef<number | null>(null);

  // リサイズ & DPR対応
  const resize = () => {
    const c = canvasRef.current!;
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = Math.floor(w * dpr);
    c.height = Math.floor(h * dpr);
  };

  // 乱数ユーティリティ
  const rand = (min: number, max: number) => Math.random() * (max - min) + min;
  const choice = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

  // ブロブ生成
  const spawnSmall = (w: number, h: number) => {
    const speed = rand(0.5, 2.2);
    const angle = rand(0, Math.PI * 2);
    const edge = choice([0, 1, 2, 3]);
    // 画面外エッジから出現
    let x = 0, y = 0;
    if (edge === 0) { x = -20; y = rand(0, h); }
    if (edge === 1) { x = w + 20; y = rand(0, h); }
    if (edge === 2) { x = rand(0, w); y = -20; }
    if (edge === 3) { x = rand(0, w); y = h + 20; }

    blobs.current.push({
      x, y, r: rand(6, 14), targetR: rand(6, 18),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      type: "small",
      ttl: 1200,
      hp: 1,
    });
  };

  const spawnBig = (w: number, h: number) => {
    // 画面の約1/2を覆う直径 → 半径は min(w,h)/4 くらい
    const targetR = Math.min(w, h) / 4;
    // 端からゆっくり入ってくる
    const side = choice(["l","r","t","b"]);
    let x = w / 2, y = h / 2;
    if (side === "l") x = -targetR * 1.2;
    if (side === "r") x = w + targetR * 1.2;
    if (side === "t") y = -targetR * 1.2;
    if (side === "b") y = h + targetR * 1.2;

    const px = player.current.x * devicePixelRatio;
    const py = player.current.y * devicePixelRatio;
    const angle = Math.atan2(py - y, px - x);
    const speed = 1.2;

    blobs.current.push({
      x, y, r: 10, targetR,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      type: "big",
      ttl: 800,
      hp: 2,
    });
  };

  const spawnUltimate = (w: number, h: number) => {
    // 予兆→全画面赤フラッシュ（安全なスキマあり）
    // 安全円をランダム配置して、そこへ逃げ込むタイプ
    const id = nextBlobId.current++;
    const safeRadius = Math.min(w, h) * 0.12; // 画面の約12%の安全円
    const safe = { x: rand(safeRadius, w - safeRadius), y: rand(safeRadius, h - safeRadius), r: safeRadius };

    // warnフェーズ（1秒）
    blobs.current.push({
      x: safe.x, y: safe.y, r: safe.r, targetR: safe.r,
      vx: 0, vy: 0, type: "ultimate", ttl: 60, warn: true, id,
    });
    // 本体フェーズ（0.8秒）: 全画面を埋め尽くす（hp=3）
    const totalR = Math.hypot(w, h);
    blobs.current.push({
      x: w / 2, y: h / 2, r: 0, targetR: totalR, vx: 0, vy: 0,
      type: "ultimate", ttl: 48, warn: false, hp: 3, id,
    });
    // 終了時にフェードアウト用ダミー（短命）
    blobs.current.push({ x: w/2, y: h/2, r: totalR, targetR: totalR, vx:0, vy:0, type: "ultimate", ttl: 8, warn: false, hp: 3, id });
  };

  // スポーン制御
  const spawnController = (t: number, w: number, h: number) => {
    // 毎フレーム小粒抽選
    if (Math.random() < 0.8) spawnSmall(w, h);
    // 3秒に一度ビッグ
    if (t % 180 === 0) spawnBig(w, h);
    // 10秒に一度アルティメット
    if (t % 600 === 0 && t > 0) spawnUltimate(w, h);
  };

  const reset = () => {
    blobs.current = [];
    setScore(0);
    setMessage("剣で撃破も可！最強は3発。Spaceで再スタート");
    setShowGameOver(false);
    setRunning(true);
  };

  // ベストスコア復元（初回のみ）
  useEffect(() => {
    try {
      const saved = localStorage.getItem(BEST_KEY);
      if (saved != null) {
        const n = Number(saved);
        if (!Number.isNaN(n)) setBest(n);
      }
    } catch {}
  }, []);

  useEffect(() => {
    const c = canvasRef.current!;
    const ctx = c.getContext("2d")!;

    const onResize = () => resize();
    window.addEventListener("resize", onResize);
    resize();

    // 入力
    const setInput = (e: MouseEvent | TouchEvent) => {
      const rect = c.getBoundingClientRect();
      let x: number, y: number;
      if (e instanceof TouchEvent) {
        const t = e.touches[0] ?? e.changedTouches[0];
        if (!t) return;
        x = (t.clientX - rect.left);
        y = (t.clientY - rect.top);
      } else {
        x = (e.clientX - rect.left);
        y = (e.clientY - rect.top);
      }
      input.current.x = x;
      input.current.y = y;
      input.current.active = true;
    };
    c.addEventListener("mousemove", setInput);
    c.addEventListener("touchstart", setInput, { passive: true });
    c.addEventListener("touchmove", setInput, { passive: true });

    const onClick = () => {
      // 剣を振る（クールダウンあり）
      if (sword.current.cooldown > 0) return;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const px = player.current.x, py = player.current.y;
      const tx = input.current.x * dpr, ty = input.current.y * dpr;
      sword.current.angle = Math.atan2(ty - py, tx - px);
      sword.current.active = true;
      sword.current.t = 10; // 10フレーム持続
      sword.current.cooldown = 18; // 連打防止
    };
    c.addEventListener("mousedown", onClick);
    c.addEventListener("touchstart", onClick, { passive: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space") reset();
    };
    window.addEventListener("keydown", onKey);

    let t = 0;

    const loop = () => {
      if (!running) return;
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const w = c.width; // 物理解像度
      const h = c.height;

      // 背景
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = "#0b1020";
      ctx.fillRect(0, 0, w, h);

      // スコア: フレーム加点は廃止（剣ヒット時のみ加点）
      t++;
      spawnController(t, w, h);

      // プレイヤー追従（なめらかに補間）
      if (input.current.active) {
        const targetX = input.current.x * dpr;
        const targetY = input.current.y * dpr;
        player.current.x += (targetX - player.current.x) * 0.25;
        player.current.y += (targetY - player.current.y) * 0.25;
      }

      // 剣のクールダウン/寿命更新
      if (sword.current.cooldown > 0) sword.current.cooldown--;
      if (sword.current.active) {
        sword.current.t--;
        if (sword.current.t <= 0) sword.current.active = false;
      }

      // ブロブ更新＆描画
      const p = player.current;
      const next: Blob[] = [];

      // 剣ヒット判定用パラメータ
      const slashRange = 160 * dpr; // 射程
      const slashHalf = (Math.PI / 180) * 40; // 半開き角（±40°）

      const angleDiff = (a: number, b: number) => {
        let d = Math.abs(a - b);
        if (d > Math.PI) d = 2 * Math.PI - d;
        return d;
      };

      for (const b of blobs.current) {
        // 速度
        b.x += b.vx;
        b.y += b.vy;
        // 半径をゆっくり目標へ
        b.r += (b.targetR - b.r) * 0.08;
        b.ttl--;
        if (b.ttl <= 0) continue;

        // === 剣ダメージ判定 ===
        if (sword.current.active) {
          const dx = b.x - p.x;
          const dy = b.y - p.y;
          const dist = Math.hypot(dx, dy);
          const angToBlob = Math.atan2(dy, dx);
          const inCone = dist <= (slashRange + b.r) && angleDiff(angToBlob, sword.current.angle) <= slashHalf;
          const damageable = !(b.type === "ultimate" && b.warn === true); // 予兆は無敵
          if (inCone && damageable) {
            // hp付与（念のため型安全）
            if (b.hp == null) {
              b.hp = b.type === "small" ? 1 : b.type === "big" ? 2 : 3;
            }
            b.hp -= 1;
            setScore((s) => s + 1);
            // 最強の本体を倒したら、同じidのultimate本体を一掃
            if (b.hp <= 0) {
              if (b.type === "ultimate") {
                const killId = b.id;
                for (const k of blobs.current) {
                  if (k.type === "ultimate" && k.warn === false && k.id === killId) {
                    k.ttl = 0;
                  }
                }
              }
              b.ttl = 0;
              continue; // 描画/衝突判定スキップ
            }
          }
        }

        // 描画
        if (b.type === "small") ctx.fillStyle = "#ff3b3b";
        else if (b.type === "big") ctx.fillStyle = "#ff6b3b";
        else ctx.fillStyle = b.warn ? "rgba(255,80,80,0.25)" : "rgba(255,0,0,0.9)";

        ctx.beginPath();
        ctx.arc(b.x, b.y, Math.max(0, b.r), 0, Math.PI * 2);
        ctx.fill();

        // アルティメット本体時は安全円をくり抜く
        if (b.type === "ultimate" && !b.warn) {
          const safe = blobs.current.find(bb => bb.type === "ultimate" && bb.warn && bb.id === b.id);
          if (safe) {
            ctx.save();
            ctx.globalCompositeOperation = "destination-out";
            ctx.beginPath();
            ctx.arc(safe.x, safe.y, safe.r * 0.9, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        }

        next.push(b);
      }

      blobs.current = next;

      // 衝突判定（アルティメットのくり抜きも考慮）
      let hit = false;
      for (const b of blobs.current) {
        if (b.type === "ultimate" && !b.warn) {
          // プレイヤーが安全円内にいればセーフ
          const safe = blobs.current.find(bb => bb.type === "ultimate" && bb.warn && bb.id === b.id);
          if (safe) {
            const dSafe = Math.hypot(p.x - safe.x, p.y - safe.y);
            const inSafe = dSafe <= (safe.r * 0.9 - p.r);
            if (!inSafe) { hit = true; break; }
            continue;
          }
        }
        const d = Math.hypot(p.x - b.x, p.y - b.y);
        if (d < p.r + b.r) { hit = true; break; }
      }

      // プレイヤー描画
      ctx.fillStyle = "white";
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * dpr, 0, Math.PI * 2);
      ctx.fill();

      // 剣のビジュアル（扇型の白いアーク）
      if (sword.current.active) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(sword.current.angle);
        ctx.beginPath();
        ctx.arc(0, 0, 160 * dpr, -Math.PI/4, Math.PI/4);
        ctx.lineWidth = 8 * dpr;
        ctx.strokeStyle = "#ffffff";
        ctx.stroke();
        ctx.restore();
      }

      // UI
      ctx.fillStyle = "#cfd8ff";
      ctx.font = `${16 * dpr}px ui-sans-serif, system-ui, -apple-system`;
      ctx.fillText(`SCORE: ${score.toString().padStart(5, '0')}`, 12 * dpr, 24 * dpr);
      ctx.fillText(`BEST:  ${best.toString().padStart(5, '0')}`, 12 * dpr, 44 * dpr);
      if (message) {
        ctx.font = `${14 * dpr}px ui-sans-serif, system-ui, -apple-system`;
        ctx.fillText(message, 12 * dpr, h - 20 * dpr);
      }

      if (hit) {
        setRunning(false);
        setMessage("GAME OVER : Spaceで再スタート");
        setBest((b) => Math.max(b, score));
        setShowGameOver(true);
        return;
      }

      raf.current = requestAnimationFrame(loop);
    };

    raf.current = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey);
      c.removeEventListener("mousemove", setInput);
      c.removeEventListener("touchstart", setInput);
      c.removeEventListener("touchmove", setInput);
      c.removeEventListener("mousedown", onClick);
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [running]);

  // ベストスコア保存
  useEffect(() => {
    try {
      localStorage.setItem(BEST_KEY, String(best));
    } catch {}
  }, [best]);

  // スコア保存
  useEffect(() => {
    try {
      localStorage.setItem(SCORE_KEY, String(score));
    } catch {}
  }, [score]);

  return (
    <div className="game-root">
      <h1 className="game-title">DodgeBlobs（避けて斬る）</h1>
      <p className="game-subtitle">白丸＝自機。赤い丸は斬ってもOK！ small=1発／big=2発／最強本体=3発</p>
      <div className="score-bar" aria-live="polite">
        <span className="chip">Score: {score}</span>
        <span className="chip chip--accent">Best: {best}</span>
      </div>
      <div className="game-controls">
        <button className="btn btn-primary" onClick={() => reset()}>リスタート</button>
        <button className="btn btn-ghost" onClick={() => setShowHelp(true)}>操作ヘルプ</button>
      </div>
      <div className="game-stage">
        <canvas ref={canvasRef} className="game-canvas"/>
      </div>
      <div className="game-hint">操作：マウス/タッチ移動・左クリック/タップで剣・Spaceで再スタート</div>

      {showGameOver && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <h2 className="modal-title">Game Over</h2>
            <div className="score-bar" style={{ marginBottom: 12 }}>
              <span className="chip">Score: {score}</span>
              <span className="chip chip--accent">Best: {best}</span>
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => reset()}>もう一度</button>
              <button className="btn btn-ghost" onClick={() => setShowHelp(true)}>操作ヘルプ</button>
            </div>
          </div>
        </div>
      )}

      {showHelp && (
        <div className="overlay" role="dialog" aria-modal="true" onClick={() => setShowHelp(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2 className="modal-title">操作ヘルプ</h2>
            <div className="help-list">
              <div>・マウス/タッチ移動で自機が追従</div>
              <div>・左クリック/タップで剣を振る（クールダウンあり）</div>
              <div>・small=1発・big=2発・最強本体=3発で撃破</div>
              <div>・当たるとゲームオーバー／Spaceで再スタート</div>
              <div>・スコアは「剣が当たった回数」で加算</div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-primary" onClick={() => setShowHelp(false)}>閉じる</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
