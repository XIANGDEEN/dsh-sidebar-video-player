window.__ModuleLoader__.load({
  id: 'dsh-sidebar-video-player',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-sidebar-video-player';
    const TYPE_ID = 'dsh-sidebar-video-player';
    const KIND = 'sidebar-video-player';

    // #region video-probe
    /**
     * A deliberately small, read-only MP4/MOV reader.
     *
     * It never decodes media: it walks top-level boxes, reads `moov` once, and
     * reports the numbers a player cannot expose (codec fourcc, profile/level,
     * per-track bitrate, sample count, exact average frame rate).
     */
    const AVC_PROFILES = {
      44: 'CAVLC 4:4:4',
      66: 'Baseline',
      77: 'Main',
      88: 'Extended',
      100: 'High',
      110: 'High 10',
      122: 'High 4:2:2',
      244: 'High 4:4:4'
    };
    const HEVC_PROFILES = {
      1: 'Main',
      2: 'Main 10',
      3: 'Main Still Picture',
      4: 'Range Extensions',
      5: 'High Throughput',
      6: 'Multiview Main',
      7: 'Scalable Main',
      9: 'Screen Content'
    };
    const AV1_PROFILES = { 0: 'Main', 1: 'High', 2: 'Professional' };
    const AV1_LEVELS = [
      '2.0', '2.1', '2.2', '2.3', '3.0', '3.1', '3.2', '3.3',
      '4.0', '4.1', '4.2', '4.3', '5.0', '5.1', '5.2', '5.3',
      '6.0', '6.1', '6.2', '6.3', '7.0', '7.1', '7.2', '7.3'
    ];
    const AAC_SAMPLE_RATES = [
      96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050,
      16000, 12000, 11025, 8000, 7350
    ];
    const CODEC_NAMES = {
      avc1: 'H.264 / AVC',
      avc3: 'H.264 / AVC',
      hvc1: 'H.265 / HEVC',
      hev1: 'H.265 / HEVC',
      av01: 'AV1',
      vp09: 'VP9',
      vp08: 'VP8',
      mp4a: 'AAC',
      opus: 'Opus',
      'Opus': 'Opus',
      fLaC: 'FLAC',
      alac: 'ALAC',
      'ac-3': 'AC-3',
      'ec-3': 'E-AC-3',
      'ac-4': 'AC-4',
      ap4h: 'ProRes 4444',
      ap4x: 'ProRes 422',
      mjpa: 'Motion JPEG',
      twos: 'PCM',
      sowt: 'PCM',
      lpcm: 'PCM'
    };

    function ascii(view, offset, length) {
      let out = '';
      for (let i = 0; i < length; i += 1) {
        const code = view.getUint8(offset + i);
        out += code >= 32 && code < 127 ? String.fromCharCode(code) : '?';
      }
      return out;
    }

    function readU64(view, offset) {
      if (typeof view.getBigUint64 === 'function') {
        return Number(view.getBigUint64(offset, false));
      }
      return view.getUint32(offset, false) * 4294967296 + view.getUint32(offset + 4, false);
    }

    function boxHeader(view, offset, end) {
      if (offset + 8 > end) return null;
      let size = view.getUint32(offset, false);
      const type = ascii(view, offset + 4, 4);
      let headerSize = 8;
      if (size === 1) {
        if (offset + 16 > end) return null;
        size = readU64(view, offset + 8);
        headerSize = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (!Number.isFinite(size) || size < headerSize) return null;
      if (offset + size > end) return null;
      return {
        type,
        size,
        headerSize,
        start: offset,
        content: offset + headerSize,
        end: offset + size
      };
    }

    function boxes(view, start, end) {
      const out = [];
      let offset = start;
      while (offset + 8 <= end && out.length < 2048) {
        const box = boxHeader(view, offset, end);
        if (box === null || box.size < 8) break;
        out.push(box);
        offset = box.end;
      }
      return out;
    }

    function findChild(view, box, type) {
      if (!box) return null;
      const children = boxes(view, box.content, box.end);
      for (const child of children) if (child.type === type) return child;
      return null;
    }

    async function readView(file, start, end) {
      const safeEnd = Math.min(end, file.size);
      const safeStart = Math.max(0, Math.min(start, safeEnd));
      if (safeEnd <= safeStart) return new DataView(new ArrayBuffer(0));
      return new DataView(await file.slice(safeStart, safeEnd).arrayBuffer());
    }

    function codecName(format) {
      return CODEC_NAMES[format] || format;
    }

    function parseFtyp(view, box) {
      const majorBrand = ascii(view, box.content, 4);
      const minorVersion = view.getUint32(box.content + 4, false);
      const compatibleBrands = [];
      for (let offset = box.content + 8; offset + 4 <= box.end; offset += 4) {
        compatibleBrands.push(ascii(view, offset, 4));
      }
      return { majorBrand, minorVersion, compatibleBrands };
    }

    function parseMvhd(view, box) {
      if (!box) return null;
      const version = view.getUint8(box.content);
      let offset = box.content + 4;
      let creation = 0;
      let modification = 0;
      let timescale = 0;
      let duration = 0;
      if (version === 1) {
        creation = readU64(view, offset);
        offset += 8;
        modification = readU64(view, offset);
        offset += 8;
        timescale = view.getUint32(offset, false);
        offset += 4;
        duration = readU64(view, offset);
      } else {
        creation = view.getUint32(offset, false);
        offset += 4;
        modification = view.getUint32(offset, false);
        offset += 4;
        timescale = view.getUint32(offset, false);
        offset += 4;
        duration = view.getUint32(offset, false);
      }
      return {
        creation,
        modification,
        timescale,
        duration,
        durationSec: timescale > 0 ? duration / timescale : 0
      };
    }

    function rotationFromMatrix(view, offset) {
      if (offset + 36 > view.byteLength) return 0;
      const a = view.getInt32(offset, false) / 65536;
      const b = view.getInt32(offset + 4, false) / 65536;
      let degrees = (Math.atan2(b, a) * 180) / Math.PI;
      let rotation = Math.round(degrees / 90) * 90;
      if (rotation < 0) rotation += 360;
      return rotation % 360;
    }

    function parseTkhd(view, box) {
      if (!box) return null;
      const version = view.getUint8(box.content);
      let offset = box.content + 4;
      let trackId = 0;
      let duration = 0;
      if (version === 1) {
        offset += 16;
        trackId = view.getUint32(offset, false);
        offset += 8;
        duration = readU64(view, offset);
        offset += 8;
      } else {
        offset += 8;
        trackId = view.getUint32(offset, false);
        offset += 8;
        duration = view.getUint32(offset, false);
        offset += 4;
      }
      offset += 16;
      const matrix = offset;
      offset += 36;
      if (offset + 8 > box.end) {
        return { trackId, duration, width: 0, height: 0, rotation: 0 };
      }
      return {
        trackId,
        duration,
        width: view.getUint32(offset, false) / 65536,
        height: view.getUint32(offset + 4, false) / 65536,
        rotation: rotationFromMatrix(view, matrix)
      };
    }

    function parseMdhd(view, box) {
      if (!box) return null;
      const version = view.getUint8(box.content);
      let offset = box.content + 4;
      offset += version === 1 ? 16 : 8;
      const timescale = view.getUint32(offset, false);
      offset += 4;
      const duration = version === 1 ? readU64(view, offset) : view.getUint32(offset, false);
      offset += version === 1 ? 8 : 4;
      let language = '';
      if (offset + 2 <= box.end) {
        const packed = view.getUint16(offset, false);
        language = String.fromCharCode(
          ((packed >> 10) & 31) + 96,
          ((packed >> 5) & 31) + 96,
          (packed & 31) + 96
        );
        if (language === '```') language = '';
      }
      return {
        timescale,
        duration,
        durationSec: timescale > 0 ? duration / timescale : 0,
        language
      };
    }

    function parseStts(view, box) {
      if (!box) return { sampleCount: 0, totalDelta: 0 };
      const entryCount = view.getUint32(box.content + 4, false);
      let offset = box.content + 8;
      let sampleCount = 0;
      let totalDelta = 0;
      for (let i = 0; i < entryCount && offset + 8 <= box.end && i < 5000000; i += 1) {
        sampleCount += view.getUint32(offset, false);
        totalDelta += view.getUint32(offset + 4, false);
        offset += 8;
      }
      return { sampleCount, totalDelta };
    }

    function parseStsz(view, box) {
      if (!box) return { sampleCount: 0, totalBytes: 0 };
      const sampleSize = view.getUint32(box.content + 4, false);
      const sampleCount = view.getUint32(box.content + 8, false);
      if (sampleSize > 0) return { sampleCount, totalBytes: sampleSize * sampleCount };
      let offset = box.content + 12;
      let totalBytes = 0;
      const available = Math.floor((box.end - offset) / 4);
      const count = Math.min(sampleCount, available, 5000000);
      for (let i = 0; i < count; i += 1) {
        totalBytes += view.getUint32(offset, false);
        offset += 4;
      }
      return { sampleCount, totalBytes, truncated: count < sampleCount };
    }

    function parseAvcC(view, box) {
      if (box.content + 4 > box.end) return {};
      const profileIdc = view.getUint8(box.content + 1);
      const levelIdc = view.getUint8(box.content + 3);
      return {
        profileIdc,
        levelIdc,
        profile: AVC_PROFILES[profileIdc] || `Profile ${profileIdc}`,
        level: (levelIdc / 10).toFixed(1)
      };
    }

    function parseHvcC(view, box) {
      if (box.content + 13 > box.end) return {};
      const profileIdc = view.getUint8(box.content + 1) & 31;
      const levelIdc = view.getUint8(box.content + 12);
      return {
        profileIdc,
        levelIdc,
        profile: HEVC_PROFILES[profileIdc] || `Profile ${profileIdc}`,
        level: (levelIdc / 30).toFixed(1)
      };
    }

    function parseAv1C(view, box) {
      if (box.content + 2 > box.end) return {};
      const byte = view.getUint8(box.content + 1);
      const profileIdc = (byte >> 5) & 7;
      const levelIndex = byte & 31;
      return {
        profileIdc,
        levelIndex,
        profile: AV1_PROFILES[profileIdc] || `Profile ${profileIdc}`,
        level: AV1_LEVELS[levelIndex] || `Level ${levelIndex}`
      };
    }

    function readDescriptor(view, offset, end) {
      if (offset + 2 > end) return null;
      const tag = view.getUint8(offset);
      let cursor = offset + 1;
      let length = 0;
      let byte = 0;
      do {
        if (cursor >= end) return null;
        byte = view.getUint8(cursor);
        cursor += 1;
        length = (length << 7) | (byte & 127);
      } while ((byte & 128) !== 0 && cursor < end && length < 16777216);
      return { tag, start: cursor, end: Math.min(end, cursor + length) };
    }

    function parseEsds(view, box) {
      const out = {
        objectType: 0,
        aot: 0,
        frequencyIndex: 0,
        channelConfig: 0,
        avgBitrate: 0,
        maxBitrate: 0
      };
      const start = box.content + 4;
      if (start >= box.end) return out;

      const walk = (from, to, depth) => {
        if (depth > 4) return;
        let offset = from;
        while (offset < to) {
          const descriptor = readDescriptor(view, offset, to);
          if (descriptor === null) return;
          if (descriptor.tag === 3) {
            let cursor = descriptor.start;
            if (cursor + 3 <= descriptor.end) {
              const flags = view.getUint8(cursor + 2);
              cursor += 3;
              if ((flags & 0x80) !== 0) cursor += 2;
              if ((flags & 0x40) !== 0 && cursor < descriptor.end) {
                cursor += 1 + view.getUint8(cursor);
              }
              if ((flags & 0x20) !== 0) cursor += 2;
              if (cursor < descriptor.end) walk(cursor, descriptor.end, depth + 1);
            }
          } else if (descriptor.tag === 4) {
            if (descriptor.start + 13 <= descriptor.end) {
              out.objectType = view.getUint8(descriptor.start);
              out.maxBitrate = view.getUint32(descriptor.start + 5, false);
              out.avgBitrate = view.getUint32(descriptor.start + 9, false);
            }
            if (descriptor.start + 13 < descriptor.end) {
              walk(descriptor.start + 13, descriptor.end, depth + 1);
            }
          } else if (descriptor.tag === 5) {
            if (descriptor.start + 2 <= descriptor.end) {
              const b0 = view.getUint8(descriptor.start);
              const b1 = view.getUint8(descriptor.start + 1);
              out.aot = b0 >> 3;
              out.frequencyIndex = ((b0 & 7) << 1) | (b1 >> 7);
              out.channelConfig = (b1 >> 3) & 15;
            }
          }
          offset = descriptor.end;
        }
      };
      walk(start, box.end, 0);
      return out;
    }

    function parseStsd(view, box, handler) {
      if (!box) return null;
      if (box.content + 8 > box.end) return null;
      const entryCount = view.getUint32(box.content + 4, false);
      if (entryCount < 1) return null;
      const entry = boxHeader(view, box.content + 8, box.end);
      if (entry === null) return null;
      const format = entry.type;
      const out = { format, codec: codecName(format) };
      if (handler === 'vide' && entry.content + 78 <= entry.end) {
        out.width = view.getUint16(entry.content + 24, false);
        out.height = view.getUint16(entry.content + 26, false);
        out.depth = view.getUint16(entry.content + 74, false);
        const children = boxes(view, entry.content + 78, entry.end);
        for (const child of children) {
          if (child.type === 'avcC') Object.assign(out, parseAvcC(view, child));
          if (child.type === 'hvcC') Object.assign(out, parseHvcC(view, child));
          if (child.type === 'av1C') Object.assign(out, parseAv1C(view, child));
        }
      } else if (handler === 'soun' && entry.content + 28 <= entry.end) {
        const version = view.getUint16(entry.content + 8, false);
        out.channels = view.getUint16(entry.content + 16, false);
        out.bits = view.getUint16(entry.content + 18, false);
        out.sampleRate = view.getUint32(entry.content + 24, false) / 65536;
        const childStart = entry.content + 28 + (version === 1 ? 16 : version === 2 ? 36 : 0);
        const children = boxes(view, childStart, entry.end);
        for (const child of children) {
          if (child.type === 'esds') {
            const esds = parseEsds(view, child);
            out.objectType = esds.objectType;
            out.aot = esds.aot;
            out.frequencyIndex = esds.frequencyIndex;
            out.channelConfig = esds.channelConfig;
            out.avgBitrate = esds.avgBitrate;
            out.maxBitrate = esds.maxBitrate;
            if (out.sampleRate === 0 && esds.frequencyIndex < AAC_SAMPLE_RATES.length) {
              out.sampleRate = AAC_SAMPLE_RATES[esds.frequencyIndex];
            }
            if (out.channels === 0) out.channels = esds.channelConfig;
          }
        }
      }
      return out;
    }

    function aacProfileName(aot) {
      const names = {
        1: 'AAC Main',
        2: 'AAC LC',
        3: 'AAC SSR',
        4: 'AAC LTP',
        5: 'HE-AAC',
        29: 'HE-AAC v2'
      };
      return names[aot] || (aot > 0 ? `AOT ${aot}` : '');
    }

    function parseTrak(view, trak) {
      const tkhd = parseTkhd(view, findChild(view, trak, 'tkhd'));
      const mdia = findChild(view, trak, 'mdia');
      if (!mdia) return null;
      const mdhd = parseMdhd(view, findChild(view, mdia, 'mdhd'));
      const hdlrBox = findChild(view, mdia, 'hdlr');
      const handler = hdlrBox ? ascii(view, hdlrBox.content + 8, 4) : '';
      const minf = findChild(view, mdia, 'minf');
      const stbl = minf ? findChild(view, minf, 'stbl') : null;
      const sample = parseStsd(view, stbl ? findChild(view, stbl, 'stsd') : null, handler);
      const timing = parseStts(view, stbl ? findChild(view, stbl, 'stts') : null);
      const sizing = parseStsz(view, stbl ? findChild(view, stbl, 'stsz') : null);
      const trackDurationSec = mdhd && mdhd.durationSec > 0
        ? mdhd.durationSec
        : mdhd && mdhd.timescale > 0
          ? timing.totalDelta / mdhd.timescale
          : 0;
      const bitrate = trackDurationSec > 0 && sizing.totalBytes > 0
        ? (sizing.totalBytes * 8) / trackDurationSec
        : 0;
      const encodedWidth = sample && sample.width ? sample.width : 0;
      const encodedHeight = sample && sample.height ? sample.height : 0;
      const displayWidth = tkhd && tkhd.width > 0 ? tkhd.width : encodedWidth;
      const displayHeight = tkhd && tkhd.height > 0 ? tkhd.height : encodedHeight;
      const kind = handler === 'vide' ? 'video' : handler === 'soun' ? 'audio' : 'other';
      const durationForRate = trackDurationSec > 0 ? trackDurationSec : 0;
      const fps = kind === 'video' && durationForRate > 0 && timing.sampleCount > 0
        ? timing.sampleCount / durationForRate
        : 0;
      return {
        kind,
        handler,
        trackId: tkhd ? tkhd.trackId : 0,
        codec: sample ? sample.codec : '',
        format: sample ? sample.format : '',
        profile: sample ? sample.profile || aacProfileName(sample.aot) || '' : '',
        level: sample ? sample.level || '' : '',
        profileIdc: sample ? sample.profileIdc : undefined,
        levelIdc: sample ? sample.levelIdc : undefined,
        width: encodedWidth,
        height: encodedHeight,
        displayWidth,
        displayHeight,
        rotation: tkhd ? tkhd.rotation : 0,
        depth: sample ? sample.depth || sample.bits || 0 : 0,
        frameCount: kind === 'video' ? timing.sampleCount : 0,
        sampleCount: timing.sampleCount,
        fps,
        bitrate,
        sampleBytes: sizing.totalBytes,
        durationSec: trackDurationSec,
        language: mdhd ? mdhd.language : '',
        sampleRate: sample ? sample.sampleRate || 0 : 0,
        channels: sample ? sample.channels || 0 : 0
      };
    }

    function parseMoov(view, root, context) {
      const mvhd = parseMvhd(view, findChild(view, root, 'mvhd'));
      const hasMvex = findChild(view, root, 'mvex') !== null;
      const traks = [];
      for (const box of boxes(view, root.content, root.end)) {
        if (box.type !== 'trak') continue;
        const track = parseTrak(view, box);
        if (track !== null) traks.push(track);
      }
      const video = traks.find((track) => track.kind === 'video') || null;
      const audio = traks.find((track) => track.kind === 'audio') || null;
      let creationTime = '';
      if (mvhd && mvhd.creation > 2082844800) {
        try {
          creationTime = new Date((mvhd.creation - 2082844800) * 1000).toISOString();
        } catch (error) {
          creationTime = '';
        }
      }
      return {
        container: {
          majorBrand: context.majorBrand,
          compatibleBrands: context.compatibleBrands,
          timescale: mvhd ? mvhd.timescale : 0,
          durationTicks: mvhd ? mvhd.duration : 0,
          durationSec: mvhd ? mvhd.durationSec : 0,
          trackCount: traks.length,
          fastStart: context.moovBeforeMdat,
          fragmented: context.fragmented || hasMvex,
          creationTime
        },
        tracks: traks,
        video,
        audio
      };
    }

    async function probeMp4(file) {
      if (!file || typeof file.slice !== 'function' || !file.size) {
        throw new Error('empty file');
      }
      const fileSize = file.size;
      let offset = 0;
      let ftyp = null;
      let moov = null;
      let moovBeforeMdat = true;
      let sawMdat = false;
      let fragmented = false;
      const topLevel = [];
      while (offset + 8 <= fileSize && topLevel.length < 512) {
        const head = await readView(file, offset, Math.min(offset + 16, fileSize));
        if (head.byteLength < 8) break;
        const box = boxHeader(head, 0, fileSize);
        if (box === null) break;
        topLevel.push(box.type);
        if (box.type === 'ftyp') {
          const view = await readView(file, offset, offset + box.size);
          ftyp = parseFtyp(view, { content: box.headerSize, end: box.size });
        } else if (box.type === 'moov') {
          if (sawMdat) moovBeforeMdat = false;
          if (moov === null) {
            moov = { start: offset, size: box.size, headerSize: box.headerSize };
          }
        } else if (box.type === 'mdat') {
          sawMdat = true;
        } else if (box.type === 'moof') {
          fragmented = true;
        }
        if (box.size < 8) break;
        offset += box.size;
      }
      if (moov === null) throw new Error('missing moov box');
      if (moov.size - moov.headerSize > 64 * 1024 * 1024) throw new Error('moov box too large');
      const view = await readView(file, moov.start, moov.start + moov.size);
      const root = {
        type: 'moov',
        size: moov.size,
        headerSize: moov.headerSize,
        start: 0,
        content: moov.headerSize,
        end: moov.size
      };
      const parsed = parseMoov(view, root, {
        majorBrand: ftyp ? ftyp.majorBrand : '',
        compatibleBrands: ftyp ? ftyp.compatibleBrands : [],
        moovBeforeMdat,
        fragmented
      });
      return {
        ...parsed,
        topLevel
      };
    }
    // #endregion

    const ZH = {
      'app.title': '视频播放器',
      'tab.title': '视频播放器',
      'guide.title': '视频播放器',
      'guide.description': '播放视频并查看分辨率、帧率、码率、缓冲与容器参数',
      'action.open': '打开视频播放器',
      'action.disabled': '请先打开一个会话',
      'action.replace': '换一个',
      'empty.title': '播放本地视频',
      'empty.hint': '拖入视频文件，或点击下方按钮选择',
      'empty.choose': '选择视频文件',
      'empty.urlPlaceholder': '或粘贴 HTTP(S) 视频地址',
      'empty.urlLabel': '视频 URL',
      'empty.load': '加载',
      'empty.note': '支持浏览器可解码的格式，如 MP4、MOV、WebM、Ogg。深度容器解析目前支持 MP4/MOV。',
      'section.live': '播放指标',
      'section.video': '视频流',
      'section.audio': '音频流',
      'section.container': '容器',
      'section.file': '文件',
      'section.raw': '原始解析数据',
      'live.time': '当前 / 总时长',
      'live.progress': '进度',
      'live.buffered': '已缓冲',
      'live.bufferAhead': '缓冲余量',
      'live.rate': '播放速率',
      'live.fps': '解码帧率',
      'live.frames': '已呈现 / 丢帧',
      'live.totalFrames': '总视频帧',
      'live.state': '状态',
      'state.playing': '播放中',
      'state.paused': '已暂停',
      'state.ended': '已结束',
      'state.buffering': '缓冲中',
      'state.ready': '就绪',
      'video.codec': '编码',
      'video.profile': '档次',
      'video.level': '级别',
      'video.encodedSize': '编码尺寸',
      'video.displaySize': '显示尺寸',
      'video.aspect': '宽高比',
      'video.rotation': '旋转',
      'video.frameCount': '帧数',
      'video.fps': '平均帧率',
      'video.bitrate': '码率',
      'video.depth': '位深',
      'video.duration': '时长',
      'video.language': '语言',
      'audio.codec': '编码',
      'audio.profile': '档次',
      'audio.sampleRate': '采样率',
      'audio.channels': '声道',
      'audio.bitrate': '码率',
      'audio.duration': '时长',
      'audio.language': '语言',
      'channel.mono': '单声道',
      'channel.stereo': '立体声',
      'channel.surround': '环绕声',
      'channel.count': '声道',
      'container.brand': '主品牌',
      'container.compatible': '兼容品牌',
      'container.duration': '时长',
      'container.timescale': '时间刻度',
      'container.tracks': '轨道数',
      'container.fastStart': 'moov 位置',
      'container.faststart.yes': '文件头（fast start）',
      'container.faststart.no': '文件尾',
      'container.fragmented': '分片',
      'container.created': '创建时间',
      'common.yes': '是',
      'common.no': '否',
      'common.unknown': '—',
      'common.none': '无',
      'common.noVideo': '无视频轨',
      'common.noAudio': '无音频轨',
      'file.name': '文件名',
      'file.size': '大小',
      'file.type': 'MIME',
      'file.modified': '修改时间',
      'file.source': '来源',
      'file.local': '本地文件',
      'file.remote': '网络地址',
      'probe.probing': '正在解析容器…',
      'probe.failed': '容器解析失败：',
      'probe.note': '深度解析支持 MP4/MOV；其他格式仍可通过播放器实测获得分辨率、帧率、丢帧等指标。',
      'probe.remote': '网络视频不做容器解析',
      'probe.unsupported': '该容器格式暂未提供深度解析',
      'playlist.title': '播放列表',
      'playlist.choose': '选择文件夹',
      'playlist.change': '更换文件夹',
      'playlist.empty': '文件夹中没有视频',
      'playlist.show': '显示播放列表',
      'playlist.hide': '隐藏播放列表',
      'playlist.nowPlaying': '正在播放',
      'sort.label': '排序',
      'sort.name': '名称',
      'sort.duration': '时长',
      'sort.modified': '修改时间',
      'sort.size': '大小',
      'sort.asc': '升序',
      'sort.desc': '降序',
      'empty.folderHint': '选择文件夹会把其中所有视频加入右侧播放列表',
      'file.path': '相对路径',
      'error.folderEmpty': '这个文件夹里没有可识别的视频文件',
      'error.notVideo': '请选择视频文件',
      'error.play': '无法播放这个视频',
      'error.url': '请输入有效的 HTTP(S) 地址',
      'control.play': '播放',
      'control.pause': '暂停',
      'control.mute': '静音',
      'control.unmute': '取消静音',
      'control.volume': '音量',
      'control.fullscreen': '全屏',
      'control.exitFullscreen': '退出全屏',
      'control.pip': '画中画',
      'control.rate': '播放速度',
      'control.seek': '播放进度'
    };

    const EN = {
      'app.title': 'Video player',
      'tab.title': 'Video player',
      'guide.title': 'Video player',
      'guide.description': 'Play video with resolution, frame rate, bitrate, buffer and container telemetry',
      'action.open': 'Open video player',
      'action.disabled': 'Open a session first',
      'action.replace': 'Replace',
      'empty.title': 'Play a local video',
      'empty.hint': 'Drop a video file here, or choose one below',
      'empty.choose': 'Choose video file',
      'empty.urlPlaceholder': 'or paste an HTTP(S) video URL',
      'empty.urlLabel': 'Video URL',
      'empty.load': 'Load',
      'empty.note': 'Browser-decodable formats such as MP4, MOV, WebM and Ogg are supported. Deep container inspection currently covers MP4/MOV.',
      'section.live': 'Playback telemetry',
      'section.video': 'Video stream',
      'section.audio': 'Audio stream',
      'section.container': 'Container',
      'section.file': 'File',
      'section.raw': 'Raw probe data',
      'live.time': 'Time / duration',
      'live.progress': 'Progress',
      'live.buffered': 'Buffered',
      'live.bufferAhead': 'Buffer ahead',
      'live.rate': 'Playback rate',
      'live.fps': 'Decoded FPS',
      'live.frames': 'Presented / dropped',
      'live.totalFrames': 'Total video frames',
      'live.state': 'State',
      'state.playing': 'Playing',
      'state.paused': 'Paused',
      'state.ended': 'Ended',
      'state.buffering': 'Buffering',
      'state.ready': 'Ready',
      'video.codec': 'Codec',
      'video.profile': 'Profile',
      'video.level': 'Level',
      'video.encodedSize': 'Coded size',
      'video.displaySize': 'Display size',
      'video.aspect': 'Aspect ratio',
      'video.rotation': 'Rotation',
      'video.frameCount': 'Frame count',
      'video.fps': 'Average FPS',
      'video.bitrate': 'Bitrate',
      'video.depth': 'Bit depth',
      'video.duration': 'Duration',
      'video.language': 'Language',
      'audio.codec': 'Codec',
      'audio.profile': 'Profile',
      'audio.sampleRate': 'Sample rate',
      'audio.channels': 'Channels',
      'audio.bitrate': 'Bitrate',
      'audio.duration': 'Duration',
      'audio.language': 'Language',
      'channel.mono': 'Mono',
      'channel.stereo': 'Stereo',
      'channel.surround': 'Surround',
      'channel.count': 'channels',
      'container.brand': 'Major brand',
      'container.compatible': 'Compatible brands',
      'container.duration': 'Duration',
      'container.timescale': 'Timescale',
      'container.tracks': 'Track count',
      'container.fastStart': 'moov position',
      'container.faststart.yes': 'Front (fast start)',
      'container.faststart.no': 'Tail',
      'container.fragmented': 'Fragmented',
      'container.created': 'Created',
      'common.yes': 'Yes',
      'common.no': 'No',
      'common.unknown': '—',
      'common.none': 'None',
      'common.noVideo': 'No video track',
      'common.noAudio': 'No audio track',
      'file.name': 'File name',
      'file.size': 'Size',
      'file.type': 'MIME',
      'file.modified': 'Modified',
      'file.source': 'Source',
      'file.local': 'Local file',
      'file.remote': 'Remote URL',
      'probe.probing': 'Reading container…',
      'probe.failed': 'Container probe failed: ',
      'probe.note': 'Deep inspection covers MP4/MOV; other formats still expose measured resolution, frame rate and dropped frames.',
      'probe.remote': 'Container probing is skipped for remote video',
      'probe.unsupported': 'Deep container inspection is not available for this format',
      'playlist.title': 'Playlist',
      'playlist.choose': 'Choose folder',
      'playlist.change': 'Change folder',
      'playlist.empty': 'No videos in this folder',
      'playlist.show': 'Show playlist',
      'playlist.hide': 'Hide playlist',
      'playlist.nowPlaying': 'Now playing',
      'sort.label': 'Sort',
      'sort.name': 'Name',
      'sort.duration': 'Duration',
      'sort.modified': 'Modified',
      'sort.size': 'Size',
      'sort.asc': 'Ascending',
      'sort.desc': 'Descending',
      'empty.folderHint': 'Choose a folder to add all its videos to the playlist on the right',
      'file.path': 'Relative path',
      'error.folderEmpty': 'No recognizable video files in this folder',
      'error.notVideo': 'Choose a video file',
      'error.play': 'This video cannot be played',
      'error.url': 'Enter a valid HTTP(S) address',
      'control.play': 'Play',
      'control.pause': 'Pause',
      'control.mute': 'Mute',
      'control.unmute': 'Unmute',
      'control.volume': 'Volume',
      'control.fullscreen': 'Fullscreen',
      'control.exitFullscreen': 'Exit fullscreen',
      'control.pip': 'Picture in picture',
      'control.rate': 'Playback rate',
      'control.seek': 'Seek'
    };

    function makeTranslator(dict) {
      return (key, params) => {
        let text = dict[key] || key;
        if (params) {
          for (const name of Object.keys(params)) {
            text = text.split(`{${name}}`).join(String(params[name]));
          }
        }
        return text;
      };
    }

    const FALLBACK = (() => {
      if (typeof navigator !== 'undefined' && /^zh/i.test(navigator.language || '')) return makeTranslator(ZH);
      return makeTranslator(EN);
    })();

    const VIDEO_FILE_RE = /\.(mp4|m4v|mov|webm|ogv|ogg|mkv|avi|mpe?g|m2ts|mts|ts|3gp|3g2|wmv|flv|f4v|m2v|asf|rm|rmvb)$/i;

    function isVideoFile(file) {
      if (!file) return false;
      const type = file.type || '';
      return type.startsWith('video/') || VIDEO_FILE_RE.test(file.name || '');
    }

    function fileKey(file) {
      if (!file) return '';
      return `${file.webkitRelativePath || file.name || ''}|${file.size || 0}|${file.lastModified || 0}`;
    }

    function playlistItem(file) {
      const path = file.webkitRelativePath || file.name || '';
      return {
        file,
        key: fileKey(file),
        name: file.name || path,
        path,
        size: file.size || 0,
        type: file.type || ''
      };
    }

    function comparePlaylistItems(left, right) {
      return left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: 'base' });
    }

    function comparePlaylistNames(left, right) {
      return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
    }

    function sortPlaylistItems(items, key, direction, thumbnails) {
      const factor = direction === 'desc' ? -1 : 1;
      const known = thumbnails || {};
      return [...items].sort((left, right) => {
        let result = 0;
        if (key === 'duration') {
          const leftDuration = known[left.key] && Number.isFinite(known[left.key].duration)
            ? known[left.key].duration
            : Number.POSITIVE_INFINITY;
          const rightDuration = known[right.key] && Number.isFinite(known[right.key].duration)
            ? known[right.key].duration
            : Number.POSITIVE_INFINITY;
          result = leftDuration - rightDuration;
        } else if (key === 'modified') {
          result = (left.file.lastModified || 0) - (right.file.lastModified || 0);
        } else if (key === 'size') {
          result = (left.size || 0) - (right.size || 0);
        } else {
          result = comparePlaylistNames(left, right);
        }
        if (Number.isNaN(result)) result = 0;
        else result = result < 0 ? -1 : result > 0 ? 1 : 0;
        if (result === 0) result = comparePlaylistItems(left, right);
        return result * factor;
      });
    }

    // #region video-thumbnail
    function waitForMediaEvent(target, eventName, timeoutMs) {
      return new Promise((resolve, reject) => {
        let timer = null;
        const cleanup = () => {
          if (timer !== null) clearTimeout(timer);
          target.removeEventListener(eventName, onEvent);
          target.removeEventListener('error', onError);
        };
        const onEvent = () => {
          cleanup();
          resolve();
        };
        const onError = () => {
          cleanup();
          reject(new Error('media error'));
        };
        timer = setTimeout(() => {
          cleanup();
          reject(new Error('media timeout'));
        }, timeoutMs);
        target.addEventListener(eventName, onEvent, { once: true });
        target.addEventListener('error', onError, { once: true });
      });
    }

    async function captureVideoThumbnail(file) {
      if (typeof document === 'undefined') throw new Error('no document');
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'auto';
      video.muted = true;
      video.playsInline = true;
      try {
        video.src = url;
        await waitForMediaEvent(video, 'loadeddata', 8000);
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const target = duration > 0 ? Math.min(0.2, duration * 0.1) : 0;
        if (target > 0) {
          try {
            video.currentTime = target;
            await waitForMediaEvent(video, 'seeked', 4000);
          } catch (seekError) {
            /* draw the frame the browser already decoded */
          }
        }
        const width = 160;
        const height = 90;
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('no 2d context');
        const sourceWidth = video.videoWidth || width;
        const sourceHeight = video.videoHeight || height;
        const scale = Math.max(width / sourceWidth, height / sourceHeight);
        const drawWidth = sourceWidth * scale;
        const drawHeight = sourceHeight * scale;
        context.drawImage(
          video,
          (width - drawWidth) / 2,
          (height - drawHeight) / 2,
          drawWidth,
          drawHeight
        );
        return { thumbnail: canvas.toDataURL('image/jpeg', 0.72), duration };
      } finally {
        try { video.pause(); } catch (pauseError) { /* ignore */ }
        video.removeAttribute('src');
        try { video.load(); } catch (loadError) { /* ignore */ }
        URL.revokeObjectURL(url);
      }
    }
    // #endregion

    const EMPTY_LIVE = {
      currentTime: 0,
      duration: 0,
      buffered: 0,
      bufferAhead: 0,
      progress: 0,
      fps: 0,
      presented: 0,
      dropped: 0,
      total: 0,
      rate: 1,
      volume: 1,
      muted: false,
      paused: true,
      readyState: 0,
      networkState: 0,
      ended: false
    };

    function fmtTime(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) return '—';
      const total = Math.floor(seconds);
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const secs = total % 60;
      const pad = (value) => String(value).padStart(2, '0');
      return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
    }

    function fmtBadgeTime(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) return '';
      const total = Math.floor(seconds);
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const secs = total % 60;
      const pad = (value) => String(value).padStart(2, '0');
      return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${pad(minutes)}:${pad(secs)}`;
    }

    function fmtInt(value) {
      if (!Number.isFinite(value)) return '—';
      return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    function fmtBytes(value) {
      if (!Number.isFinite(value) || value <= 0) return '—';
      const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
      let size = value;
      let unit = 0;
      while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit += 1;
      }
      return `${unit === 0 ? Math.round(size) : size.toFixed(2)} ${units[unit]}`;
    }

    function fmtBitrate(bitsPerSecond) {
      if (!Number.isFinite(bitsPerSecond) || bitsPerSecond <= 0) return '—';
      if (bitsPerSecond >= 1000000) return `${(bitsPerSecond / 1000000).toFixed(2)} Mbps`;
      return `${Math.round(bitsPerSecond / 1000)} kbps`;
    }

    function fmtSampleRate(hz) {
      if (!Number.isFinite(hz) || hz <= 0) return '—';
      return hz >= 1000 ? `${(hz / 1000).toFixed(1)} kHz` : `${Math.round(hz)} Hz`;
    }

    function fmtPercent(value) {
      if (!Number.isFinite(value)) return '—';
      return `${(value * 100).toFixed(1)}%`;
    }

    function gcd(left, right) {
      let a = Math.abs(Math.round(left));
      let b = Math.abs(Math.round(right));
      while (b > 0) {
        const next = a % b;
        a = b;
        b = next;
      }
      return a || 1;
    }

    function fmtAspect(width, height) {
      if (!width || !height) return '';
      const value = width / height;
      const common = [[16, 9], [4, 3], [21, 9], [9, 16], [3, 2], [2, 1], [1, 1]];
      for (const ratio of common) {
        if (Math.abs(value - ratio[0] / ratio[1]) < 0.01) return `${ratio[0]}:${ratio[1]}`;
      }
      const divisor = gcd(width, height);
      const a = Math.round(width / divisor);
      const b = Math.round(height / divisor);
      if (a <= 100 && b <= 100) return `${a}:${b}`;
      return `${value.toFixed(3)}:1`;
    }

    function fmtDate(value) {
      if (!value) return '—';
      try {
        return new Date(value).toLocaleString();
      } catch (error) {
        return '—';
      }
    }

    function channelLabel(count, t) {
      if (!count) return '—';
      if (count === 1) return t('channel.mono');
      if (count === 2) return t('channel.stereo');
      if (count === 6 || count === 8) return `${t('channel.surround')} (${count})`;
      return `${count} ${t('channel.count')}`;
    }

    function VideoGlyph({ size = 16, className }) {
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        className,
        'aria-hidden': true,
        focusable: 'false'
      },
        h('rect', { x: 2.5, y: 4.5, width: 19, height: 15, rx: 3, stroke: 'currentColor', strokeWidth: 1.6 }),
        h('path', { d: 'M10 8.8v6.4l5.4-3.2L10 8.8Z', fill: 'currentColor' })
      );
    }

    function PlayIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M5.2 3.4v9.2l7.2-4.6-7.2-4.6Z', fill: 'currentColor' })
      );
    }

    function PauseIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 4, y: 3, width: 3, height: 10, rx: 0.8, fill: 'currentColor' }),
        h('rect', { x: 9, y: 3, width: 3, height: 10, rx: 0.8, fill: 'currentColor' })
      );
    }

    function VolumeIcon({ muted = false, size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M3 6.2v3.6h2.4L8.8 12V4L5.4 6.2H3Z', fill: 'currentColor' }),
        muted
          ? h('path', { d: 'M10.6 6.1l3 3.8M13.6 6.1l-3 3.8', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' })
          : h('path', { d: 'M10.4 6.1a3 3 0 0 1 0 3.8M12.2 4.8a5 5 0 0 1 0 6.4', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' })
      );
    }

    function FullscreenIcon({ exit = false, size = 16 }) {
      const paths = exit
        ? ['M6 2.8v3.2H2.8', 'M10 2.8v3.2h3.2', 'M6 13.2v-3.2H2.8', 'M10 13.2v-3.2h3.2']
        : ['M2.8 6V2.8H6', 'M13.2 6V2.8H10', 'M2.8 10v3.2H6', 'M13.2 10v3.2H10'];
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        paths.map((d, index) => h('path', { key: index, d, stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }))
      );
    }

    function PipIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 2, y: 3, width: 12, height: 10, rx: 1.6, stroke: 'currentColor', strokeWidth: 1.3 }),
        h('rect', { x: 7.6, y: 8, width: 5, height: 3.6, rx: 0.7, fill: 'currentColor' })
      );
    }

    function FolderIcon({ size = 14 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M2 4.6c0-.7.5-1.2 1.2-1.2h2.6l1.2 1.4h5.8c.7 0 1.2.5 1.2 1.2v5.4c0 .7-.5 1.2-1.2 1.2H3.2c-.7 0-1.2-.5-1.2-1.2V4.6Z', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' })
      );
    }

    function ListIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M3 4.5h10M3 8h10M3 11.5h10', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' })
      );
    }

    function Row({ label, value, accent }) {
      const text = value === undefined || value === null || value === '' ? '—' : String(value);
      return h('div', { className: 'dsh-vp-row' },
        h('span', { className: 'dsh-vp-label', title: label }, label),
        h('span', { className: 'dsh-vp-value' + (accent ? ' dsh-vp-value-accent' : ''), title: text }, text)
      );
    }

    function Section({ title, note, children }) {
      return h('section', { className: 'dsh-vp-card' },
        h('div', { className: 'dsh-vp-card-head' },
          h('span', null, title),
          note ? h('span', { className: 'dsh-vp-card-note' }, note) : null
        ),
        children
      );
    }

    function VideoTabTitle({ useTabInfo }) {
      const info = typeof useTabInfo === 'function' ? useTabInfo() : null;
      const title = info && info.tab ? info.tab.title : 'Video';
      return h('span', { className: 'dsh-vp-tabtitle' },
        h(VideoGlyph, { size: 14 }),
        h('span', null, title)
      );
    }

    function OpenAction({ sidebarRight, t, wide }) {
      const translate = typeof t === 'function' ? t : FALLBACK;
      const mounted = React.useSyncExternalStore(
        (callback) => sidebarRight.mounted.subscribe(callback),
        () => sidebarRight.mounted.getSnapshot()
      );
      const disabled = mounted === undefined;
      return h('button', {
        type: 'button',
        className: 'dsh-vp-action',
        disabled,
        title: disabled ? translate('action.disabled') : translate('action.open'),
        'aria-label': translate('action.open'),
        onClick: () => {
          try {
            sidebarRight.openTab(KIND);
          } catch (error) {
            console.warn('[dsh-video-player] openTab failed', error);
          }
        }
      },
        h(VideoGlyph, { size: 16 })
      );
    }

    function VideoPanel(props) {
      const t = typeof props.t === 'function' ? props.t : FALLBACK;
      const useTabInfo = props.useTabInfo;
      const tabInfo = typeof useTabInfo === 'function' ? useTabInfo() : null;
      const visible = !tabInfo || !tabInfo.tab || tabInfo.tab.visible !== false;

      const containerRef = React.useRef(null);
      const videoRef = React.useRef(null);
      const fileRef = React.useRef(null);
      const folderRef = React.useRef(null);
      const probeSeq = React.useRef(0);
      const fpsRef = React.useRef(0);

      const [source, setSource] = React.useState(null);
      const [probe, setProbe] = React.useState({ status: 'idle' });
      const [meta, setMeta] = React.useState(null);
      const [live, setLive] = React.useState(EMPTY_LIVE);
      const [paused, setPaused] = React.useState(true);
      const [muted, setMuted] = React.useState(false);
      const [volume, setVolume] = React.useState(1);
      const [rate, setRate] = React.useState(1);
      const [scrub, setScrub] = React.useState(null);
      const [dropOver, setDropOver] = React.useState(false);
      const [error, setError] = React.useState(null);
      const [urlInput, setUrlInput] = React.useState('');
      const [playlist, setPlaylist] = React.useState({ name: '', items: [] });
      const [activeKey, setActiveKey] = React.useState('');
      const [showPlaylist, setShowPlaylist] = React.useState(true);
      const [sortKey, setSortKey] = React.useState('name');
      const [sortDirection, setSortDirection] = React.useState('asc');
      const [thumbs, setThumbs] = React.useState({});
      const thumbRef = React.useRef({});
      const thumbGeneration = React.useRef(0);

      const replaceSource = React.useCallback((next) => {
        setSource(next);
      }, []);

      React.useEffect(() => {
        if (!source || source.kind !== 'file' || !source.url) return undefined;
        return () => URL.revokeObjectURL(source.url);
      }, [source]);

      React.useEffect(() => () => {
        probeSeq.current += 1;
      }, []);

      React.useEffect(() => {
        const video = videoRef.current;
        if (video && !visible && !video.paused) video.pause();
      }, [visible]);

      React.useEffect(() => {
        if (!playlist.items.length) return undefined;
        const generation = thumbGeneration.current + 1;
        thumbGeneration.current = generation;
        let cancelled = false;
        let cursor = 0;
        const worker = async () => {
          while (!cancelled) {
            const index = cursor;
            cursor += 1;
            if (index >= playlist.items.length) return;
            const item = playlist.items[index];
            if (thumbRef.current[item.key]) continue;
            try {
              const captured = await captureVideoThumbnail(item.file);
              if (cancelled || generation !== thumbGeneration.current) return;
              thumbRef.current[item.key] = captured;
              setThumbs((previous) => ({ ...previous, [item.key]: captured }));
            } catch (error) {
              if (cancelled || generation !== thumbGeneration.current) return;
              thumbRef.current[item.key] = { failed: true };
            }
          }
        };
        void Promise.all([worker(), worker()]);
        return () => {
          cancelled = true;
        };
      }, [playlist.items]);

      const sortedItems = React.useMemo(
        () => sortPlaylistItems(playlist.items, sortKey, sortDirection, thumbs),
        [playlist.items, sortKey, sortDirection, thumbs]
      );

      const startProbe = React.useCallback((file) => {
        const seq = probeSeq.current + 1;
        probeSeq.current = seq;
        setProbe({ status: 'probing' });
        probeMp4(file)
          .then((data) => {
            if (probeSeq.current === seq) setProbe({ status: 'done', data });
          })
          .catch((reason) => {
            if (probeSeq.current === seq) {
              setProbe({ status: 'error', error: reason && reason.message ? reason.message : String(reason) });
            }
          });
      }, []);

      const loadFileSource = React.useCallback((file, options = {}) => {
        if (!file) return;
        if (!isVideoFile(file)) {
          setError(t('error.notVideo'));
          return;
        }
        const name = file.name || '';
        const type = file.type || '';
        const url = URL.createObjectURL(file);
        replaceSource({
          kind: 'file',
          url,
          file,
          name,
          size: file.size || 0,
          type,
          lastModified: file.lastModified || 0,
          path: file.webkitRelativePath || '',
          autoplay: options.autoplay === true,
          playlistKey: options.playlistKey || ''
        });
        setError(null);
        setMeta(null);
        setLive(EMPTY_LIVE);
        setScrub(null);
        setActiveKey(options.playlistKey || '');
        fpsRef.current = 0;
        const mp4ish = /\.(mp4|m4v|mov)$/i.test(name) || /mp4|quicktime/i.test(type);
        if (mp4ish) {
          startProbe(file);
        } else {
          probeSeq.current += 1;
          setProbe({ status: 'skipped', reason: t('probe.unsupported') });
        }
      }, [replaceSource, startProbe, t]);

      const openFile = React.useCallback((file) => {
        if (!file) return;
        const key = fileKey(file);
        const match = playlist.items.find((item) => item.key === key);
        loadFileSource(file, { autoplay: false, playlistKey: match ? match.key : '' });
      }, [loadFileSource, playlist.items]);

      const openFolder = React.useCallback((fileList) => {
        const items = Array.from(fileList || [])
          .filter(isVideoFile)
          .map(playlistItem)
          .sort(comparePlaylistItems);
        const name = items.length > 0 ? (items[0].path.split('/')[0] || '') : '';
        thumbRef.current = {};
        setThumbs({});
        setPlaylist({ name, items });
        setShowPlaylist(items.length > 0);
        if (items.length === 0) {
          setError(t('error.folderEmpty'));
          return;
        }
        setError(null);
        const ordered = sortPlaylistItems(items, sortKey, sortDirection, {});
        loadFileSource(ordered[0].file, { autoplay: false, playlistKey: ordered[0].key });
      }, [loadFileSource, sortDirection, sortKey, t]);

      const openPlaylistItem = React.useCallback((item) => {
        if (!item) return;
        if (item.key === activeKey && source && source.playlistKey === item.key) {
          const video = videoRef.current;
          if (!video) return;
          if (video.paused || video.ended) {
            const promise = video.play();
            if (promise && typeof promise.catch === 'function') {
              promise.catch((reason) => setError(reason && reason.message ? reason.message : String(reason)));
            }
          } else {
            video.pause();
          }
          return;
        }
        loadFileSource(item.file, { autoplay: true, playlistKey: item.key });
      }, [activeKey, source, loadFileSource]);

      const playNext = React.useCallback(() => {
        if (!sortedItems.length || !activeKey) return;
        const index = sortedItems.findIndex((item) => item.key === activeKey);
        if (index < 0 || index + 1 >= sortedItems.length) return;
        const next = sortedItems[index + 1];
        loadFileSource(next.file, { autoplay: true, playlistKey: next.key });
      }, [sortedItems, activeKey, loadFileSource]);

      const openUrl = React.useCallback((raw) => {
        const value = String(raw || '').trim();
        if (!value) return;
        let parsed;
        try {
          parsed = new URL(value);
        } catch (parseError) {
          setError(t('error.url'));
          return;
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          setError(t('error.url'));
          return;
        }
        let name = parsed.hostname;
        const rawName = parsed.pathname.split('/').filter(Boolean).pop();
        if (rawName) {
          try {
            name = decodeURIComponent(rawName);
          } catch (decodeError) {
            name = rawName;
          }
        }
        replaceSource({
          kind: 'url',
          url: parsed.href,
          name,
          size: 0,
          type: '',
          lastModified: 0,
          path: '',
          autoplay: false,
          playlistKey: ''
        });
        probeSeq.current += 1;
        setProbe({ status: 'skipped', reason: t('probe.remote') });
        setError(null);
        setMeta(null);
        setLive(EMPTY_LIVE);
        setScrub(null);
        setActiveKey('');
        fpsRef.current = 0;
      }, [replaceSource, t]);

      const togglePlay = React.useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        if (video.paused || video.ended) {
          const promise = video.play();
          if (promise && typeof promise.catch === 'function') {
            promise.catch((reason) => setError(reason && reason.message ? reason.message : String(reason)));
          }
        } else {
          video.pause();
        }
      }, []);

      const seekTo = React.useCallback((value) => {
        const video = videoRef.current;
        if (!video) return;
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const next = Math.max(0, Math.min(duration || 0, Number(value) || 0));
        try {
          video.currentTime = next;
        } catch (seekError) {
          /* a non-seekable remote stream keeps its current position */
        }
        setScrub(next);
        setLive((previous) => ({
          ...previous,
          currentTime: next,
          progress: duration > 0 ? next / duration : 0
        }));
      }, []);

      const seekBy = React.useCallback((delta) => {
        const video = videoRef.current;
        if (!video) return;
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        const next = Math.max(0, Math.min(duration || 0, video.currentTime + delta));
        try {
          video.currentTime = next;
        } catch (seekError) {
          /* ignore non-seekable streams */
        }
        setScrub(null);
      }, []);

      const toggleMute = React.useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        video.muted = !video.muted;
        if (!video.muted && video.volume === 0) video.volume = 1;
      }, []);

      const changeVolume = React.useCallback((value) => {
        const video = videoRef.current;
        if (!video) return;
        const next = Math.max(0, Math.min(1, Number(value) || 0));
        video.volume = next;
        video.muted = next === 0;
      }, []);

      const changeRate = React.useCallback((value) => {
        const video = videoRef.current;
        if (!video) return;
        const next = Number(value) || 1;
        video.playbackRate = next;
        setRate(next);
      }, []);

      const toggleFullscreen = React.useCallback(() => {
        const element = containerRef.current;
        if (!element) return;
        if (document.fullscreenElement) {
          if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
        } else if (element.requestFullscreen) {
          element.requestFullscreen().catch((reason) => setError(reason && reason.message ? reason.message : String(reason)));
        }
      }, []);

      const togglePip = React.useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        if (document.pictureInPictureElement) {
          document.exitPictureInPicture().catch(() => {});
        } else if (video.requestPictureInPicture) {
          video.requestPictureInPicture().catch((reason) => setError(reason && reason.message ? reason.message : String(reason)));
        }
      }, []);

      React.useEffect(() => {
        if (!source) return undefined;
        const timer = window.setInterval(() => {
          const video = videoRef.current;
          if (!video) return;
          let buffered = 0;
          try {
            for (let index = 0; index < video.buffered.length; index += 1) {
              buffered = Math.max(buffered, video.buffered.end(index));
            }
          } catch (bufferError) {
            buffered = 0;
          }
          const duration = Number.isFinite(video.duration) ? video.duration : 0;
          const currentTime = video.currentTime || 0;
          const quality = typeof video.getVideoPlaybackQuality === 'function' ? video.getVideoPlaybackQuality() : null;
          setLive({
            currentTime,
            duration,
            buffered,
            bufferAhead: Math.max(0, buffered - currentTime),
            progress: duration > 0 ? Math.min(1, currentTime / duration) : 0,
            fps: fpsRef.current,
            presented: quality ? Math.max(0, quality.totalVideoFrames - quality.droppedVideoFrames) : 0,
            dropped: quality ? quality.droppedVideoFrames : 0,
            total: quality ? quality.totalVideoFrames : 0,
            rate: video.playbackRate,
            volume: video.volume,
            muted: video.muted,
            paused: video.paused,
            readyState: video.readyState,
            networkState: video.networkState,
            ended: video.ended
          });
          setPaused(video.paused);
          setMuted(video.muted);
          setVolume(video.volume);
          setRate(video.playbackRate);
        }, 400);
        return () => window.clearInterval(timer);
      }, [source]);

      React.useEffect(() => {
        if (!source) return undefined;
        const video = videoRef.current;
        if (!video || typeof video.requestVideoFrameCallback !== 'function') return undefined;
        let handle = 0;
        let frames = 0;
        let windowStart = performance.now();
        let stopped = false;
        fpsRef.current = 0;
        const tick = (now) => {
          if (stopped) return;
          frames += 1;
          const elapsed = now - windowStart;
          if (elapsed >= 1000) {
            fpsRef.current = Math.round((frames * 10000) / elapsed) / 10;
            frames = 0;
            windowStart = now;
          }
          handle = video.requestVideoFrameCallback(tick);
        };
        handle = video.requestVideoFrameCallback(tick);
        return () => {
          stopped = true;
          if (handle && typeof video.cancelVideoFrameCallback === 'function') video.cancelVideoFrameCallback(handle);
        };
      }, [source]);

      const onLoadedMetadata = () => {
        const video = videoRef.current;
        if (!video) return;
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        setMeta({
          duration,
          width: video.videoWidth || 0,
          height: video.videoHeight || 0
        });
        setLive((previous) => ({
          ...previous,
          duration,
          currentTime: video.currentTime || 0,
          progress: duration > 0 ? (video.currentTime || 0) / duration : 0
        }));
        setPaused(video.paused);
      };

      const onVideoError = () => {
        const video = videoRef.current;
        const code = video && video.error ? video.error.code : 0;
        setError(`${t('error.play')}${code ? ` (${code})` : ''}`);
        setPaused(true);
      };

      const onKeyDown = (event) => {
        if (event.defaultPrevented) return;
        const target = event.target;
        const tag = target && target.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (target && target.isContentEditable)) return;
        if (target !== event.currentTarget && (tag === 'BUTTON' || tag === 'A')) return;
        if (event.key === ' ' || event.key === 'k' || event.key === 'K') {
          event.preventDefault();
          togglePlay();
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          seekBy(-5);
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          seekBy(5);
        } else if (event.key === 'j' || event.key === 'J') {
          event.preventDefault();
          seekBy(-10);
        } else if (event.key === 'l' || event.key === 'L') {
          event.preventDefault();
          seekBy(10);
        } else if (event.key === 'm' || event.key === 'M') {
          event.preventDefault();
          toggleMute();
        } else if (event.key === 'f' || event.key === 'F') {
          event.preventDefault();
          toggleFullscreen();
        }
      };

      const onDrop = (event) => {
        event.preventDefault();
        event.stopPropagation();
        setDropOver(false);
        const files = event.dataTransfer && event.dataTransfer.files;
        if (files && files.length > 0) openFile(files[0]);
      };

      const onDragOver = (event) => {
        event.preventDefault();
        setDropOver(true);
      };

      const onDragLeave = (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDropOver(false);
      };

      const duration = live.duration || (meta && meta.duration) || 0;
      const info = probe.status === 'done' ? probe.data : null;
      const videoTrack = info ? info.video : null;
      const audioTrack = info ? info.audio : null;
      const container = info ? info.container : null;
      const measuredWidth = (meta && meta.width) || (videoTrack && (videoTrack.displayWidth || videoTrack.width)) || 0;
      const measuredHeight = (meta && meta.height) || (videoTrack && (videoTrack.displayHeight || videoTrack.height)) || 0;
      const progressValue = scrub === null ? live.currentTime : scrub;
      const progressPercent = duration > 0 ? Math.max(0, Math.min(100, (progressValue / duration) * 100)) : 0;
      const bufferPercent = duration > 0 ? Math.max(0, Math.min(100, (live.buffered / duration) * 100)) : 0;
      const bufferEnd = Math.max(progressPercent, bufferPercent);
      const stateLabel = live.ended
        ? t('state.ended')
        : !live.paused
          ? t('state.playing')
          : live.readyState < 3 && live.currentTime === 0
            ? t('state.buffering')
            : t('state.paused');
      const rawJson = React.useMemo(() => {
        const snapshot = {
          source: source
            ? {
              kind: source.kind,
              name: source.name,
              size: source.size,
              type: source.type,
              lastModified: source.lastModified,
              path: source.path,
              playlistKey: source.playlistKey,
              autoplay: source.autoplay
            }
            : null,
          meta,
          probe: probe.status === 'done' ? probe.data : { status: probe.status, error: probe.error, reason: probe.reason }
        };
        try {
          return JSON.stringify(snapshot, null, 2);
        } catch (stringifyError) {
          return '';
        }
      }, [source, meta, probe]);

      const row = (label, value, accent) => h(Row, { key: label, label, value, accent });
      const rows = [];

      rows.push(row(t('live.time'), `${fmtTime(live.currentTime)} / ${fmtTime(duration)}`, true));
      rows.push(row(t('live.progress'), fmtPercent(live.progress)));
      rows.push(row(t('live.buffered'), `${fmtTime(live.buffered)} · ${fmtPercent(live.buffered && duration ? live.buffered / duration : 0)}`));
      rows.push(row(t('live.bufferAhead'), `+${Math.max(0, live.bufferAhead).toFixed(1)} s`));
      rows.push(row(t('live.rate'), `${(live.rate || 1).toFixed(2)}×`));
      rows.push(row(t('live.fps'), live.fps > 0 ? `${live.fps.toFixed(1)} fps` : '—', live.fps > 0));
      rows.push(row(t('live.frames'), `${fmtInt(live.presented)} / ${fmtInt(live.dropped)}`));
      rows.push(row(t('live.totalFrames'), fmtInt(live.total)));
      rows.push(row(t('live.state'), stateLabel));

      const videoRows = [];
      if (videoTrack) {
        videoRows.push(row(t('video.codec'), `${videoTrack.codec}${videoTrack.format ? ` · ${videoTrack.format}` : ''}`, true));
        if (videoTrack.profile) videoRows.push(row(t('video.profile'), videoTrack.profile));
        if (videoTrack.level) videoRows.push(row(t('video.level'), videoTrack.level));
        if (videoTrack.width && videoTrack.height) {
          videoRows.push(row(t('video.encodedSize'), `${videoTrack.width} × ${videoTrack.height}`));
        }
        if (videoTrack.displayWidth && videoTrack.displayHeight) {
          videoRows.push(row(t('video.displaySize'), `${Math.round(videoTrack.displayWidth)} × ${Math.round(videoTrack.displayHeight)}`));
        }
        const aspect = fmtAspect(videoTrack.displayWidth || videoTrack.width, videoTrack.displayHeight || videoTrack.height);
        if (aspect) videoRows.push(row(t('video.aspect'), aspect));
        if (videoTrack.rotation) videoRows.push(row(t('video.rotation'), `${videoTrack.rotation}°`));
        if (videoTrack.frameCount) videoRows.push(row(t('video.frameCount'), fmtInt(videoTrack.frameCount)));
        if (videoTrack.fps) videoRows.push(row(t('video.fps'), `${videoTrack.fps.toFixed(3)} fps`));
        if (videoTrack.bitrate) videoRows.push(row(t('video.bitrate'), fmtBitrate(videoTrack.bitrate)));
        if (videoTrack.depth) videoRows.push(row(t('video.depth'), `${videoTrack.depth} bit`));
        if (videoTrack.durationSec) videoRows.push(row(t('video.duration'), fmtTime(videoTrack.durationSec)));
        if (videoTrack.language && videoTrack.language !== 'und') videoRows.push(row(t('video.language'), videoTrack.language));
      } else if (measuredWidth && measuredHeight) {
        videoRows.push(row(t('video.displaySize'), `${measuredWidth} × ${measuredHeight}`, true));
        const aspect = fmtAspect(measuredWidth, measuredHeight);
        if (aspect) videoRows.push(row(t('video.aspect'), aspect));
        videoRows.push(row(t('video.codec'), t('common.unknown')));
      } else {
        videoRows.push(row(t('video.codec'), t('common.noVideo')));
      }

      const audioRows = [];
      if (audioTrack) {
        audioRows.push(row(t('audio.codec'), `${audioTrack.codec}${audioTrack.format ? ` · ${audioTrack.format}` : ''}`, true));
        if (audioTrack.profile) audioRows.push(row(t('audio.profile'), audioTrack.profile));
        if (audioTrack.sampleRate) audioRows.push(row(t('audio.sampleRate'), fmtSampleRate(audioTrack.sampleRate)));
        if (audioTrack.channels) audioRows.push(row(t('audio.channels'), channelLabel(audioTrack.channels, t)));
        if (audioTrack.bitrate) audioRows.push(row(t('audio.bitrate'), fmtBitrate(audioTrack.bitrate)));
        if (audioTrack.durationSec) audioRows.push(row(t('audio.duration'), fmtTime(audioTrack.durationSec)));
        if (audioTrack.language && audioTrack.language !== 'und') audioRows.push(row(t('audio.language'), audioTrack.language));
      } else if (info) {
        audioRows.push(row(t('audio.codec'), t('common.noAudio')));
      } else {
        audioRows.push(row(t('audio.codec'), t('common.unknown')));
      }

      const containerRows = [];
      if (container) {
        if (container.majorBrand) containerRows.push(row(t('container.brand'), container.majorBrand, true));
        if (container.compatibleBrands && container.compatibleBrands.length > 0) {
          containerRows.push(row(t('container.compatible'), container.compatibleBrands.join(', ')));
        }
        if (container.durationSec) containerRows.push(row(t('container.duration'), fmtTime(container.durationSec)));
        if (container.timescale) containerRows.push(row(t('container.timescale'), `${fmtInt(container.timescale)} Hz`));
        if (container.trackCount) containerRows.push(row(t('container.tracks'), String(container.trackCount)));
        containerRows.push(row(t('container.fastStart'), container.fastStart ? t('container.faststart.yes') : t('container.faststart.no')));
        containerRows.push(row(t('container.fragmented'), container.fragmented ? t('common.yes') : t('common.no')));
        if (container.creationTime) containerRows.push(row(t('container.created'), fmtDate(container.creationTime)));
      } else {
        containerRows.push(row(t('container.brand'), t('common.unknown')));
      }

      const fileRows = [];
      if (source) {
        fileRows.push(row(t('file.name'), source.name, true));
        fileRows.push(row(t('file.size'), source.size > 0 ? fmtBytes(source.size) : t('common.unknown')));
        fileRows.push(row(t('file.type'), source.type || t('common.unknown')));
        if (source.path && source.path !== source.name) fileRows.push(row(t('file.path'), source.path));
        if (source.lastModified) fileRows.push(row(t('file.modified'), fmtDate(source.lastModified)));
        fileRows.push(row(t('file.source'), source.kind === 'file' ? t('file.local') : t('file.remote')));
      }

      let probeNotice = null;
      if (probe.status === 'probing') probeNotice = t('probe.probing');
      if (probe.status === 'error') probeNotice = `${t('probe.failed')}${probe.error || ''}`;
      if (probe.status === 'skipped') probeNotice = probe.reason || t('probe.unsupported');

      const header = h('div', { className: 'dsh-vp-head' },
        h(VideoGlyph, { size: 17, className: 'dsh-vp-head-icon' }),
        h('div', { className: 'dsh-vp-title', title: source ? source.name : t('app.title') },
          source ? source.name : t('app.title')
        ),
        h('div', { className: 'dsh-vp-head-actions' },
          source
            ? h('button', {
              type: 'button',
              className: 'dsh-vp-iconbtn',
              title: t('playlist.choose'),
              'aria-label': t('playlist.choose'),
              onClick: () => { if (folderRef.current) folderRef.current.click(); }
            }, h(FolderIcon, { size: 15 }))
            : null,
          playlist.items.length > 0
            ? h('button', {
              type: 'button',
              className: 'dsh-vp-iconbtn',
              title: showPlaylist ? t('playlist.hide') : t('playlist.show'),
              'aria-label': showPlaylist ? t('playlist.hide') : t('playlist.show'),
              'aria-pressed': showPlaylist,
              onClick: () => setShowPlaylist((value) => !value)
            }, h(ListIcon))
            : null,
          source
            ? h('button', {
              type: 'button',
              className: 'dsh-vp-btn',
              onClick: () => { if (fileRef.current) fileRef.current.click(); }
            }, h(VideoGlyph, { size: 14 }), t('action.replace'))
            : null
        )
      );

      const fileInput = h('input', {
        ref: fileRef,
        type: 'file',
        accept: 'video/*,.mkv',
        style: { display: 'none' },
        onChange: (event) => {
          const file = event.target.files && event.target.files[0];
          if (file) openFile(file);
          event.target.value = '';
        }
      });

      const folderInput = h('input', {
        ref: folderRef,
        type: 'file',
        webkitdirectory: '',
        directory: '',
        multiple: true,
        style: { display: 'none' },
        onChange: (event) => {
          openFolder(event.target.files);
          event.target.value = '';
        }
      });

      if (!source) {
        return h('div', {
          className: 'dsh-vp-root',
          ref: containerRef,
          tabIndex: 0,
          onKeyDown,
          onDragOver,
          onDragEnter: onDragOver,
          onDragLeave,
          onDrop
        },
          header,
          fileInput,
          folderInput,
          h('div', { className: 'dsh-vp-empty' },
            h('div', { className: 'dsh-vp-drop', 'data-over': dropOver ? 'true' : 'false' },
              h(VideoGlyph, { size: 38, className: 'dsh-vp-drop-icon' }),
              h('div', { className: 'dsh-vp-drop-title' }, t('empty.title')),
              h('div', { className: 'dsh-vp-drop-hint' }, t('empty.hint')),
              h('div', { className: 'dsh-vp-empty-actions' },
                h('button', {
                  type: 'button',
                  className: 'dsh-vp-btn dsh-vp-btn-cta',
                  onClick: () => { if (fileRef.current) fileRef.current.click(); }
                }, h(VideoGlyph, { size: 14 }), t('empty.choose')),
                h('button', {
                  type: 'button',
                  className: 'dsh-vp-btn',
                  onClick: () => { if (folderRef.current) folderRef.current.click(); }
                }, h(FolderIcon), t('playlist.choose'))
              )
            ),
            h('div', { className: 'dsh-vp-note' }, t('empty.folderHint')),
            h('form', {
              className: 'dsh-vp-url',
              onSubmit: (event) => {
                event.preventDefault();
                openUrl(urlInput);
              }
            },
              h('input', {
                className: 'dsh-vp-input',
                type: 'url',
                inputMode: 'url',
                value: urlInput,
                placeholder: t('empty.urlPlaceholder'),
                'aria-label': t('empty.urlLabel'),
                onChange: (event) => setUrlInput(event.target.value)
              }),
              h('button', {
                className: 'dsh-vp-btn',
                type: 'submit',
                disabled: !urlInput.trim()
              }, t('empty.load'))
            ),
            error ? h('div', { className: 'dsh-vp-error', role: 'alert' }, error) : null,
            h('div', { className: 'dsh-vp-note' }, t('empty.note'))
          )
        );
      }

      const videoElement = h('video', {
        key: source.url,
        ref: videoRef,
        className: 'dsh-vp-video',
        src: source.url,
        autoPlay: source.autoplay === true,
        preload: 'metadata',
        playsInline: true,
        onClick: togglePlay,
        onLoadedMetadata,
        onDurationChange: onLoadedMetadata,
        onError: onVideoError,
        onEnded: playNext,
        onPlay: () => setPaused(false),
        onPause: () => {
          fpsRef.current = 0;
          setPaused(true);
        }
      });

      const playlistPanel = playlist.items.length > 0
        ? h('aside', { className: 'dsh-vp-playlist', 'aria-label': t('playlist.title') },
          h('div', { className: 'dsh-vp-playlist-head' },
            h('div', { className: 'dsh-vp-playlist-title', title: playlist.name || t('playlist.title') },
              playlist.name || t('playlist.title')
            ),
            h('span', { className: 'dsh-vp-playlist-count' }, String(playlist.items.length)),
            h('button', {
              type: 'button',
              className: 'dsh-vp-iconbtn',
              title: t('playlist.change'),
              'aria-label': t('playlist.change'),
              onClick: () => { if (folderRef.current) folderRef.current.click(); }
            }, h(FolderIcon, { size: 14 }))
          ),
          h('div', { className: 'dsh-vp-playlist-sort' },
            h('select', {
              className: 'dsh-vp-select dsh-vp-sort-select',
              value: sortKey,
              'aria-label': t('sort.label'),
              title: t('sort.label'),
              onChange: (event) => setSortKey(event.target.value)
            },
              [
                ['name', t('sort.name')],
                ['duration', t('sort.duration')],
                ['modified', t('sort.modified')],
                ['size', t('sort.size')]
              ].map(([value, label]) => h('option', { key: value, value }, label))
            ),
            h('button', {
              type: 'button',
              className: 'dsh-vp-iconbtn dsh-vp-sort-direction',
              title: sortDirection === 'asc' ? t('sort.desc') : t('sort.asc'),
              'aria-label': sortDirection === 'asc' ? t('sort.desc') : t('sort.asc'),
              onClick: () => setSortDirection((value) => (value === 'asc' ? 'desc' : 'asc'))
            }, sortDirection === 'asc' ? '↑' : '↓')
          ),
          h('div', { className: 'dsh-vp-playlist-list' },
            sortedItems.map((item, index) => {
              const captured = thumbs[item.key];
              return h('button', {
                key: item.key,
                type: 'button',
                className: 'dsh-vp-playlist-item' + (item.key === activeKey ? ' dsh-vp-playlist-item-active' : ''),
                title: item.path,
                'aria-current': item.key === activeKey ? 'true' : undefined,
                onClick: () => openPlaylistItem(item)
              },
                h('span', { className: 'dsh-vp-playlist-thumb' },
                  captured && captured.thumbnail
                    ? h('img', {
                      src: captured.thumbnail,
                      alt: '',
                      loading: 'lazy',
                      draggable: false
                    })
                    : h('span', { className: 'dsh-vp-playlist-thumb-placeholder' }, h(VideoGlyph, { size: 18 })),
                  captured && captured.duration
                    ? h('span', { className: 'dsh-vp-playlist-duration' }, fmtBadgeTime(captured.duration))
                    : null,
                  item.key === activeKey
                    ? h('span', { className: 'dsh-vp-playlist-badge' }, t('playlist.nowPlaying'))
                    : h('span', { className: 'dsh-vp-playlist-index' }, String(index + 1).padStart(2, '0'))
                ),
                h('span', { className: 'dsh-vp-playlist-text' },
                  h('span', { className: 'dsh-vp-playlist-name' }, item.name),
                  h('span', { className: 'dsh-vp-playlist-path' }, item.path),
                  h('span', { className: 'dsh-vp-playlist-size' }, fmtBytes(item.size))
                )
              );
            })
          )
        )
        : null;

      const mainColumn = h('div', { className: 'dsh-vp-main' },
        h('div', { className: 'dsh-vp-stage' },
          videoElement,
          paused && !live.ended
            ? h('button', {
              type: 'button',
              className: 'dsh-vp-overlay',
              onClick: togglePlay,
              'aria-label': t('control.play')
            }, h(PlayIcon, { size: 46 }))
            : null
        ),
        h('div', { className: 'dsh-vp-controls' },
          h('div', { className: 'dsh-vp-timeline' },
            h('span', { className: 'dsh-vp-time' }, fmtTime(progressValue)),
            h('input', {
              className: 'dsh-vp-range',
              type: 'range',
              min: 0,
              max: duration > 0 ? duration : 0,
              step: 0.01,
              value: duration > 0 ? Math.min(progressValue, duration) : 0,
              'aria-label': t('control.seek'),
              style: { '--vp-progress': `${progressPercent}%`, '--vp-buffer': `${bufferEnd}%` },
              onChange: (event) => seekTo(Number(event.target.value)),
              onPointerUp: () => setScrub(null),
              onKeyUp: () => setScrub(null),
              onBlur: () => setScrub(null),
              disabled: duration <= 0
            }),
            h('span', { className: 'dsh-vp-time' }, fmtTime(duration))
          ),
          h('div', { className: 'dsh-vp-toolbar' },
            h('button', {
              type: 'button',
              className: 'dsh-vp-iconbtn',
              onClick: togglePlay,
              title: paused ? t('control.play') : t('control.pause'),
              'aria-label': paused ? t('control.play') : t('control.pause')
            }, paused ? h(PlayIcon) : h(PauseIcon)),
            h('button', {
              type: 'button',
              className: 'dsh-vp-iconbtn',
              onClick: toggleMute,
              title: muted ? t('control.unmute') : t('control.mute'),
              'aria-label': muted ? t('control.unmute') : t('control.mute')
            }, h(VolumeIcon, { muted })),
            h('input', {
              className: 'dsh-vp-range dsh-vp-volume',
              type: 'range',
              min: 0,
              max: 1,
              step: 0.01,
              value: muted ? 0 : volume,
              'aria-label': t('control.volume'),
              style: { '--vp-progress': `${(muted ? 0 : volume) * 100}%`, '--vp-buffer': '100%' },
              onChange: (event) => changeVolume(Number(event.target.value))
            }),
            h('span', { className: 'dsh-vp-spacer' }),
            h('select', {
              className: 'dsh-vp-select',
              value: String(rate),
              'aria-label': t('control.rate'),
              title: t('control.rate'),
              onChange: (event) => changeRate(Number(event.target.value))
            },
              [0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => h('option', { key: value, value: String(value) }, `${value}×`))
            ),
            typeof document !== 'undefined' && document.pictureInPictureEnabled
              ? h('button', {
                type: 'button',
                className: 'dsh-vp-iconbtn',
                onClick: togglePip,
                title: t('control.pip'),
                'aria-label': t('control.pip')
              }, h(PipIcon))
              : null,
            h('button', {
              type: 'button',
              className: 'dsh-vp-iconbtn',
              onClick: toggleFullscreen,
              title: t('control.fullscreen'),
              'aria-label': t('control.fullscreen')
            }, h(FullscreenIcon))
          )
        ),
        error ? h('div', { className: 'dsh-vp-error', role: 'alert' }, error) : null,
        h('div', { className: 'dsh-vp-stats' },
          probeNotice ? h('div', { className: 'dsh-vp-note' }, probeNotice) : null,
          h(Section, { title: t('section.live') }, rows),
          h(Section, { title: t('section.video'), note: videoTrack ? videoTrack.codec : null }, videoRows),
          h(Section, { title: t('section.audio'), note: audioTrack ? audioTrack.codec : null }, audioRows),
          h(Section, { title: t('section.container') }, containerRows),
          h(Section, { title: t('section.file') }, fileRows),
          h('details', { className: 'dsh-vp-raw' },
            h('summary', null, t('section.raw')),
            h('pre', null, rawJson)
          )
        )
      );

      return h('div', {
        className: 'dsh-vp-root',
        ref: containerRef,
        tabIndex: 0,
        onKeyDown,
        onDragOver,
        onDragEnter: onDragOver,
        onDragLeave,
        onDrop
      },
        header,
        fileInput,
        folderInput,
        h('div', { className: 'dsh-vp-body' },
          mainColumn,
          showPlaylist ? playlistPanel : null
        )
      );
    }

    const CSS = `
.dsh-vp-root{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.45;background:transparent}
.dsh-vp-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none;min-width:0}
.dsh-vp-head-icon{color:var(--dsw-alias-brand-primary);flex:none}
.dsh-vp-title{flex:1;min-width:0;font-weight:600;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-vp-head-actions{display:flex;align-items:center;gap:4px;flex:none}
.dsh-vp-body{display:flex;flex:1;min-height:0;min-width:0}
.dsh-vp-main{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0}
.dsh-vp-playlist{flex:0 0 clamp(136px,38%,220px);min-width:120px;display:flex;flex-direction:column;min-height:0;border-left:.5px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1)}
.dsh-vp-playlist-head{display:flex;align-items:center;gap:6px;padding:6px 6px 6px 9px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none;min-width:0}
.dsh-vp-playlist-title{flex:1;min-width:0;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-vp-playlist-count{flex:none;font-size:11px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dsh-vp-playlist-sort{display:flex;align-items:center;gap:4px;padding:4px 6px 4px 9px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none}
.dsh-vp-sort-select{flex:1;min-width:0;height:26px;font-size:12px;font-weight:600;padding:0 6px}
.dsh-vp-sort-direction{width:26px;height:26px;font-size:15px;font-weight:600;line-height:1}
.dsh-vp-playlist-list{flex:1;min-height:0;overflow:auto;padding:4px}
.dsh-vp-playlist-item{display:flex;flex-direction:column;gap:4px;width:100%;text-align:left;padding:4px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;cursor:pointer;min-width:0}
.dsh-vp-playlist-item:hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-vp-playlist-item-active{background:var(--dsw-alias-bg-layer-2);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}
.dsh-vp-playlist-item:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}
.dsh-vp-playlist-thumb{position:relative;display:flex;align-items:center;justify-content:center;width:100%;aspect-ratio:16/9;border-radius:6px;overflow:hidden;background:var(--dsw-alias-bg-layer-2)}
.dsh-vp-playlist-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.dsh-vp-playlist-thumb-placeholder{display:flex;color:var(--dsw-alias-label-secondary)}
.dsh-vp-playlist-index,.dsh-vp-playlist-badge{position:absolute;left:4px;top:4px;padding:0 4px;border-radius:3px;font-size:10px;line-height:15px;max-width:calc(100% - 8px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-vp-playlist-index{background:rgba(0,0,0,.58);color:#fff;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.dsh-vp-playlist-badge{background:var(--dsw-alias-brand-primary);color:#fff}
.dsh-vp-playlist-duration{position:absolute;right:4px;bottom:4px;padding:0 4px;border-radius:3px;background:rgba(0,0,0,.7);color:#fff;font-size:10px;line-height:15px;font-variant-numeric:tabular-nums}
.dsh-vp-playlist-text{display:flex;flex-direction:column;gap:1px;min-width:0;padding:0 2px}
.dsh-vp-playlist-name{font-size:12px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-vp-playlist-path{font-size:10.5px;color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-vp-playlist-size{font-size:10.5px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dsh-vp-playlist-item-active .dsh-vp-playlist-name{color:var(--dsw-alias-brand-primary)}
@media (max-width:420px){.dsh-vp-playlist{flex-basis:136px;min-width:112px}.dsh-vp-playlist-path{display:none}}
.dsh-vp-stage{position:relative;flex:none;display:flex;align-items:center;justify-content:center;background:#000;aspect-ratio:16/9;max-height:44vh;min-height:110px;overflow:hidden}
.dsh-vp-video{width:100%;height:100%;display:block;object-fit:contain;background:#000}
.dsh-vp-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;border:0;background:rgba(0,0,0,.22);color:#fff;cursor:pointer;padding:0}
.dsh-vp-overlay:hover{background:rgba(0,0,0,.3)}
.dsh-vp-overlay:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-3px}
.dsh-vp-controls{flex:none;display:flex;flex-direction:column;gap:3px;padding:5px 10px 7px;border-bottom:.5px solid var(--dsw-alias-border-l1)}
.dsh-vp-timeline{display:flex;align-items:center;gap:6px}
.dsh-vp-time{flex:none;min-width:34px;text-align:center;color:var(--dsw-alias-label-secondary);font-size:10.5px;font-variant-numeric:tabular-nums;white-space:nowrap}
.dsh-vp-toolbar{display:flex;align-items:center;gap:1px;min-width:0}
.dsh-vp-spacer{flex:1}
.dsh-vp-iconbtn{width:26px;height:26px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:none}
.dsh-vp-iconbtn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsh-vp-iconbtn:focus-visible,.dsh-vp-btn:focus-visible,.dsh-vp-input:focus-visible,.dsh-vp-select:focus-visible,.dsh-vp-action:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsh-vp-volume{width:58px;flex:none}
.dsh-vp-select{height:26px;padding:0 6px;border:.5px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;font-weight:500;cursor:pointer;color-scheme:light}
body[data-ds-dark-theme] .dsh-vp-select,html[data-ds-dark-theme] .dsh-vp-select{color-scheme:dark}
.dsh-vp-select option{background-color:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:500}
.dsh-vp-range{appearance:none;-webkit-appearance:none;width:100%;height:16px;margin:0;padding:0;background:transparent;cursor:pointer;--vp-progress:0%;--vp-buffer:0%}
.dsh-vp-range::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:linear-gradient(to right,var(--dsw-alias-brand-primary) 0 var(--vp-progress),var(--dsw-alias-border-l2) var(--vp-progress) var(--vp-buffer),var(--dsw-alias-bg-layer-2) var(--vp-buffer) 100%)}
.dsh-vp-range::-moz-range-track{height:4px;border-radius:2px;background:linear-gradient(to right,var(--dsw-alias-brand-primary) 0 var(--vp-progress),var(--dsw-alias-border-l2) var(--vp-progress) var(--vp-buffer),var(--dsw-alias-bg-layer-2) var(--vp-buffer) 100%)}
.dsh-vp-range::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:11px;height:11px;margin-top:-3.5px;border:0;border-radius:50%;background:var(--dsw-alias-label-primary)}
.dsh-vp-range::-moz-range-thumb{width:11px;height:11px;border:0;border-radius:50%;background:var(--dsw-alias-label-primary)}
.dsh-vp-stats{flex:1;min-height:0;overflow:auto;padding:9px 9px 18px;display:flex;flex-direction:column;gap:8px}
.dsh-vp-card{border:.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;flex:none}
.dsh-vp-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 10px;font-size:10.5px;font-weight:600;color:var(--dsw-alias-label-secondary);border-bottom:.5px solid var(--dsw-alias-border-l1)}
.dsh-vp-card-note{font-weight:400;color:var(--dsw-alias-label-secondary);opacity:.8;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:55%}
.dsh-vp-row{display:flex;align-items:baseline;gap:8px;padding:3.5px 10px;min-width:0}
.dsh-vp-row+.dsh-vp-row{border-top:.5px solid var(--dsw-alias-border-l1)}
.dsh-vp-label{flex:none;width:82px;color:var(--dsw-alias-label-secondary);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-vp-value{flex:1;min-width:0;text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}
.dsh-vp-value-accent{color:var(--dsw-alias-brand-primary)}
.dsh-vp-note{padding:5px 9px;color:var(--dsw-alias-label-secondary);font-size:10.5px;line-height:1.5}
.dsh-vp-error{margin:8px 10px 0;padding:7px 9px;border:.5px solid var(--dsw-alias-state-error-primary);border-radius:7px;color:var(--dsw-alias-state-error-primary);font-size:11px;white-space:pre-wrap;word-break:break-word}
.dsh-vp-empty{flex:1;min-height:0;overflow:auto;display:flex;flex-direction:column;gap:10px;padding:14px 12px 20px}
.dsh-vp-drop{display:flex;flex-direction:column;align-items:center;gap:8px;padding:22px 12px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;background:var(--dsw-alias-bg-layer-1);text-align:center;color:var(--dsw-alias-label-secondary)}
.dsh-vp-drop[data-over="true"]{border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.dsh-vp-drop-icon{color:var(--dsw-alias-brand-primary)}
.dsh-vp-drop-title{color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600}
.dsh-vp-drop-hint{font-size:11px;max-width:240px}
.dsh-vp-empty-actions{display:flex;flex-wrap:wrap;gap:6px;justify-content:center}
.dsh-vp-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 10px;border:.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px;cursor:pointer;white-space:nowrap}
.dsh-vp-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}
.dsh-vp-btn:disabled{opacity:.5;cursor:default}
.dsh-vp-btn-cta{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);background:transparent}
.dsh-vp-url{display:flex;gap:6px}
.dsh-vp-input{flex:1;min-width:0;height:28px;padding:0 8px;border:.5px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:11px}
.dsh-vp-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:.7}
.dsh-vp-raw{border:.5px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;flex:none}
.dsh-vp-raw summary{padding:7px 10px;font-size:11px;color:var(--dsw-alias-label-secondary);cursor:pointer;user-select:none}
.dsh-vp-raw pre{margin:0;padding:8px 10px;border-top:.5px solid var(--dsw-alias-border-l1);font-size:10px;line-height:1.5;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto;color:var(--dsw-alias-label-secondary)}
.dsh-vp-action{width:28px;height:28px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.dsh-vp-action:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsh-vp-action:disabled{opacity:.4;cursor:default}
.dsh-vp-tabtitle{display:inline-flex;align-items:center;gap:5px;min-width:0;overflow:hidden}
.dsh-vp-tabtitle>span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-vp-root:fullscreen{background:var(--dsw-alias-bg-base)}
.dsh-vp-root:fullscreen .dsh-vp-stage{max-height:none;flex:1;aspect-ratio:auto;min-height:0}
.dsh-vp-root:fullscreen .dsh-vp-stats{display:none}
.dsh-vp-root:fullscreen .dsh-vp-playlist{display:none}
@media (max-width:360px){.dsh-vp-label{width:70px}.dsh-vp-volume{display:none}}
`;

    return {
      inject: ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);

        ctx.effect(() => {
          if (typeof document === 'undefined') return undefined;
          const style = document.createElement('style');
          style.dataset.plugin = NS;
          style.textContent = CSS;
          document.head.appendChild(style);
          return () => style.remove();
        }, 'dsh-video-player: styles');

        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-video-player: locale');

        ctx.effect(() => ctx.sidebarRightTabs.register({
          id: TYPE_ID,
          kind: KIND,
          priority: 'extension',
          title: () => t('tab.title'),
          keepMounted: true,
          guide: [{
            id: 'video-player',
            order: 30,
            title: () => t('guide.title'),
            description: () => t('guide.description'),
            icon: VideoGlyph
          }]
        }), 'dsh-video-player: tab type');

        ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab',
          key: TYPE_ID,
          locale: NS
        }, VideoPanel));

        ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({
          name: 'sidebar.right.pane.tab.title',
          key: TYPE_ID
        }, VideoTabTitle));

        ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'dsh-sidebar-video-player',
          order: 50,
          label: () => t('action.open'),
          locale: NS
        }, (props) => h(OpenAction, Object.assign({}, props, { sidebarRight: ctx.sidebarRight }))));
      }
    };
  }
});
