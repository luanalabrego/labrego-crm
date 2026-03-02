'use client'

import { useRef, useState, useEffect, useCallback } from 'react'
import { PlayIcon, PauseIcon } from '@radix-ui/react-icons'

const SPEEDS = [1, 1.5, 2]

function formatTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function AudioPlayer({ url }: { url: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [speedIdx, setSpeedIdx] = useState(0)

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onMeta = () => setDuration(audio.duration)
    const onTime = () => setCurrentTime(audio.currentTime)
    const onEnd = () => setPlaying(false)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('ended', onEnd)
    return () => {
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('ended', onEnd)
    }
  }, [])

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
    } else {
      audio.play()
    }
    setPlaying(!playing)
  }, [playing])

  const cycleSpeed = useCallback(() => {
    const next = (speedIdx + 1) % SPEEDS.length
    setSpeedIdx(next)
    if (audioRef.current) {
      audioRef.current.playbackRate = SPEEDS[next]
    }
  }, [speedIdx])

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audio.currentTime = pct * duration
  }, [duration])

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div className="flex items-center gap-2 mt-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
      <audio ref={audioRef} preload="none" src={url} />
      <button
        onClick={togglePlay}
        className="w-7 h-7 flex items-center justify-center rounded-full bg-primary-600 text-white hover:bg-primary-700 transition-colors flex-shrink-0"
      >
        {playing ? <PauseIcon className="w-3.5 h-3.5" /> : <PlayIcon className="w-3.5 h-3.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <div
          className="w-full h-1.5 bg-slate-200 rounded-full cursor-pointer"
          onClick={handleSeek}
        >
          <div
            className="h-full bg-primary-500 rounded-full transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      <span className="text-[10px] text-slate-400 tabular-nums flex-shrink-0 w-[70px] text-center">
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>
      <button
        onClick={cycleSpeed}
        className="px-1.5 py-0.5 text-[10px] font-bold bg-slate-200 hover:bg-slate-300 rounded text-slate-600 transition-colors flex-shrink-0"
        title="Velocidade de reproducao"
      >
        {SPEEDS[speedIdx]}x
      </button>
    </div>
  )
}
