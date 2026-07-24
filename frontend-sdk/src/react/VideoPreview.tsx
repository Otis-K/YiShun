import { useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';

const formatTime = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const rest = `${whole % 60}`.padStart(2, '0');
  return `${minutes}:${rest}`;
};

export function VideoPreview({ src, title, className }: { src: string; title: string; className: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);

  const syncTime = () => {
    const element = video.current;
    if (!element) return;
    setCurrent(Number.isFinite(element.currentTime) ? element.currentTime : 0);
    setDuration(Number.isFinite(element.duration) ? element.duration : 0);
  };

  const toggle = () => {
    const element = video.current;
    if (!element) return;
    if (element.paused) {
      void element.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      element.pause();
      setPlaying(false);
    }
  };

  const seek = (value: number) => {
    const element = video.current;
    if (!element || !Number.isFinite(value)) return;
    element.currentTime = value;
    setCurrent(value);
  };

  return <div className={`${className} fc-video-preview fc-node__drag-zone`}>
    <video
      ref={video}
      className="nowheel"
      src={src}
      draggable={false}
      muted
      playsInline
      preload="metadata"
      aria-label={`${title}视频预览`}
      onPause={() => { setPlaying(false); syncTime(); }}
      onPlay={() => { setPlaying(true); syncTime(); }}
      onLoadedMetadata={syncTime}
      onDurationChange={syncTime}
      onTimeUpdate={syncTime}
      onClick={toggle}
    />
    <div className="fc-video-preview__controls nodrag nowheel" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <button className="fc-video-preview__toggle" type="button" aria-label={`${playing ? '暂停' : '播放'}视频预览`} onClick={toggle}>
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <input
        className="fc-video-preview__progress"
        type="range"
        min="0"
        max={duration || 0}
        step="0.01"
        value={duration ? Math.min(current, duration) : 0}
        aria-label="视频播放进度"
        onChange={event => seek(Number(event.currentTarget.value))}
      />
      <span className="fc-video-preview__time">{formatTime(current)} / {formatTime(duration)}</span>
    </div>
  </div>;
}
