'use strict';

/** Shared by the public calendar and the administrator's preview. */
function eventDetails(event) {
  const when = formatDate(event.start, true) + (isMulti(event) ? ' — ' + formatDate(event.end, true) : '');
  const row = (name, value) => value ? `<div class="meta-row"><span class="meta-label">${esc(t(name))}</span><div class="meta-value">${value}</div></div>` : '';
  let notice = '';
  if (event.cancelled) {
    notice = `<div class="change-notice cancel-notice"><strong>${esc(t('cancelled'))}</strong><p>${esc(event.cancelReason || (state.lang ? 'This event will not take place.' : '此事件不再举行，保留记录供查阅。'))}</p></div>`;
  } else if (event.oldDate) {
    const previous = event.previousSchedule;
    const original = previous ? `${formatDate(previous.start)}${previous.end && previous.end !== previous.start ? ' — ' + formatDate(previous.end) : ''} · ${timeText(previous)}` : formatDate(event.oldDate);
    notice = `<div class="change-notice"><strong>${esc(t('changed'))}</strong><p>${state.lang ? 'Previously: ' : '原定：'}${esc(original)}</p><p>${state.lang ? 'Now: ' : '现定：'}${esc(when)} · ${esc(timeText(event))}</p></div>`;
  }
  return `<span class="detail-type ${esc(event.type)}"><span class="dot"></span>${esc(text(types[event.type].label))}</span>
    <h2>${esc(text(event.title))}</h2><p class="detail-subtitle">${esc(scopeText(event))} · ${state.lang ? 'School event' : '校园公共事件'}</p>${notice}
    <div class="detail-meta">
      ${row('when', `${esc(when)}<small>${esc(timeText(event))} · ${state.lang ? 'School local time' : '学校当地时间'}</small>`)}
      ${row('where', esc(text(event.location)))}
      ${row('for', event.scope.map(s => `<span class="scope-badge">${esc(t(s))}</span>`).join(''))}
      ${row('host', esc(text(event.host)))}
    </div>
    ${text(event.description) ? `<section class="detail-section"><h3>${esc(t('about'))}</h3><p>${esc(text(event.description))}</p>${text(event.extra) ? `<p class="detail-extra">${esc(text(event.extra))}</p>` : ''}</section>` : ''}
    ${event.poster?`<section class="detail-section"><h3>${state.lang?'Event poster':'事件海报'}</h3>${mediaImage(event.poster,state.lang?'Event poster — open full size':'事件海报，点击放大',true)}</section>`:''}
    ${!event.cancelled&&(event.registrationUrl||event.qr||event.registration)?`<section class="detail-section"><h3>${state.lang?'Registration':'报名入口'}</h3>${event.registrationUrl?`<a class="primary registration-button" href="${esc(event.registrationUrl)}" target="_blank" rel="noopener noreferrer">${esc(t('registration'))} ↗</a>`:event.registration?`<button class="primary registration-button" data-registration>${esc(t('registration'))} ↗</button>`:''}${event.qr?mediaImage(event.qr,state.lang?'Registration QR code':'报名二维码',false):''}<p class="external-note">${esc(t('external'))}</p></section>`:''}
    ${event.type==='exam'?`<a class="primary registration-button" href="exams.html?date=${encodeURIComponent(event.start)}&division=${encodeURIComponent(event.scope.find(s=>s!=='schoolwide')||'high')}">${state.lang?'View exam schedules':'查看考试安排'} →</a>`:''}
    <p class="detail-updated">${esc(event.updatedAt ? (state.lang ? 'Updated: ' : '更新于：') + new Intl.DateTimeFormat(state.lang?'en-GB':'zh-CN',{timeZone:settings.timeZone,dateStyle:'medium',timeStyle:'short'}).format(new Date(event.updatedAt)) : '')}</p>`;
}

function bindDetailActions(root) {
  root.querySelectorAll('[data-zoom]').forEach(button=>button.onclick=()=>{
    const dialog=$('#media-dialog');
    $('#media-heading').textContent=state.lang?'Event poster':'事件海报';
    $('#close-media').setAttribute('aria-label',state.lang?'Close image':'关闭图片');
    $('#media-image').src=button.dataset.zoom;
    $('#media-image').alt=state.lang?'Full size event poster':'完整事件海报';
    dialog.showModal();
  });
  root.querySelectorAll('.event-media img').forEach(img=>{
    const failed=()=>{img.closest('.event-media').innerHTML=`<p class="media-fallback">${state.lang?'Image unavailable. Other event details remain available.':'图片暂不可用，请查看其他事件信息。'}</p>`;};
    img.onerror=failed;if(img.complete&&!img.naturalWidth)failed();
  });
  root.querySelectorAll('[data-registration]').forEach(button => {
    button.onclick = () => $('#registration-dialog').showModal();
  });
}

function mediaImage(src,alt,zoom){
  const image=`<img src="${esc(src)}" alt="${esc(alt)}" class="${zoom?'poster-image':'qr-image'}">`;
  return `<div class="event-media">${zoom?`<button type="button" class="poster-button" data-zoom="${esc(src)}">${image}</button>`:image}</div>`;
}
