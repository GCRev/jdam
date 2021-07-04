import Transport, { TransportParams } from './sound_transport'
import Metro from './metro'
import { Frames } from './sound'

/*
 * typescript doesn't have this interface defined even though it's been around
 * for like five years 
 */
declare const MediaRecorder: any

interface SoundRecorderParams extends TransportParams {
  audioCtx: AudioContext
  measures: number
  metro: Metro
  deviceId: string
}

class SoundRecorder extends Transport {
  playState = 'stopped'
  metro: Metro
  measures = 4
  syncs = new Map<Transport, number>()
  deviceId: string

  metroGain: GainNode

  totalLength = 1000

  _stopRecording?: () => void

  constructor({ 
    audioCtx,
    measures,
    sounds,
    deviceId,
    metro
  }: SoundRecorderParams) {
    super({
      sounds,
      audioCtx
    })

    this.measures = measures
    this.metroGain = audioCtx.createGain()
    this.metro = metro 
    this.deviceId = deviceId
  }

  setLoopLength({ loopLength }: { loopLength: number}) {
    super.setLoopLength({ loopLength })

    /* add one measure on the (front) and 2000 ms off the end */
    const totalLength = loopLength + this.metro.getPatternLength() + 2000
    this.totalLength = totalLength
    this.sounds.forEach(sound => { 
      this.setSoundMs({ sound, ms: totalLength })
    })

    return this
  }

  async startRecording(): Promise<AnalyserNode> {

    await this.metro.getClicks('click')

    this.metro.previewMetroStart({})
    this.setPlayhead(0)
    /* stop recording at limit of length */
    const stopTimeout = window.setTimeout(() => {
      this.stop()
    }, (this.totalLength || this.loopLength))

    const stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: this.deviceId } })
    const sound = this.sounds[0]
    delete sound.audioBuffer
    this.sounds.forEach(sound => { 
      this.setSoundMs({ sound, ms: this.totalLength })
      this.resetSoundStops({ sound })
    })

    const analyzer = this.audioCtx.createAnalyser()
    const mediaStreamNode = this.audioCtx.createMediaStreamSource(stream)
    mediaStreamNode.connect(analyzer)

    const recorder = new MediaRecorder(stream)

    recorder.start(1000)

    this.fire('start-recording', { analyzer })

    let updateId = -1
    const startTime = this.audioCtx.currentTime
    this.startTime = startTime

    const frames: Frames = []
    /* this is kinda cheating */
    sound.frames = frames

    const chunks = new Array<Blob>()

    recorder.addEventListener('dataavailable', async ({ data }: { data: Blob }) => {
      chunks.push(data)
    })
    recorder.addEventListener('stop', () => {
      const file = new File(chunks, `${sound.uid}.ogg`, {
        type: recorder.mimeType
      })
      this.fire('stop-recording', { file })
    })

    this._stopRecording = () => {
      /* do nothing I guess */
      this.metro.previewMetroStop()
      window.cancelAnimationFrame(updateId)
      window.clearTimeout(stopTimeout)
      recorder.stop()
      analyzer.disconnect()
      mediaStreamNode.disconnect()
    }

    const update = () => {
      const data = new Uint8Array(2048)
      analyzer.getByteTimeDomainData(data)
      let min = 127
      let max = 127
      for (const val of data) {
        min = Math.min(val, min)
        max = Math.max(val, max)
      }
      frames.push({
        min: min - 127,
        max: max - 127,
        ts: (this.audioCtx.currentTime - startTime) * 1000 
      })
      updateId = window.requestAnimationFrame(update)
      this.setSoundFrames({ sound, frames })
    }
    update()

    return analyzer

  }

  stopRecording() {
    if (this._stopRecording) {
      this._stopRecording()
      this._stopRecording = undefined
    }
  }

  setPlayState(state: string) {

    if (state === this.playState) { return this }

    switch (state) {
    case 'recording':
      this.startRecording().then(() => {
        super.setPlayState(state)
      })
      break
    default:
      this.stopRecording()
      super.setPlayState(state)
      break
    }

    return this
  }

  mapPlayState(state = this.playState) {
    if (state === 'recording') { return 'playing' }
    return state
  }

}

export default SoundRecorder
