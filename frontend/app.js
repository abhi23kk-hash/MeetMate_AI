const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const sampleText = 'Abhishek: We should finalize the placement dataset by October 20. Rahul will prepare the frontend prototype by October 18. Sneha will integrate authentication and share the test plan. The team agreed to run internal testing before release and review progress next week.';

function toast(message) {
	const node = $('#toast');
	if (!node) return;
	node.textContent = message;
	node.classList.add('show');
	clearTimeout(toast.timer);
	toast.timer = setTimeout(() => node.classList.remove('show'), 2400);
}

function formatDate(value) {
	if (!value) return 'Date not set';
	const date = new Date(value);
	return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatMeetingDate(meeting) {
	if (!meeting.date) return 'Date not set';
	const start = new Date(meeting.date);
	if (Number.isNaN(start.valueOf())) return meeting.date;
	const date = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).format(start);
	const startTime = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(start);
	const endTime = meeting.endDate ? new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(meeting.endDate)) : '';
	return `${date} | ${startTime}${endTime ? ` - ${endTime}` : ''}`;
}

function initials(name) {
	return String(name).trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
}

async function transcribeFile(file, transcript, status) {
	status.textContent = 'Transcribing audio...';
	const form = new FormData();
	form.append('file', file);
	const response = await fetch('/api/transcribe', { method: 'POST', body: form });
	const result = await response.json();
	if (!response.ok) throw new Error(result.error || 'Audio transcription failed');
	transcript.value = result.transcript || '';
	transcript.dispatchEvent(new Event('input'));
	status.textContent = 'Audio transcription complete.';
}

function initNewMeeting() {
	const transcript = $('#transcriptInput');
	const count = $('#charCount');
	const status = $('#transcriptStatus');
	let preview = null;
	let activeResultsTab = 'Summary';
	let recorder = null;
	let recordingStream = null;
	let recordingChunks = [];
	transcript.addEventListener('input', () => { count.textContent = `${transcript.value.length.toLocaleString()} / 50,000`; });
	$('#sampleButton').addEventListener('click', () => {
		transcript.value = sampleText;
		transcript.dispatchEvent(new Event('input'));
		toast('Sample transcript loaded');
	});
	document.querySelectorAll('.mode-tab').forEach((button) => button.addEventListener('click', () => {
		document.querySelectorAll('.mode-tab').forEach((tab) => tab.classList.toggle('active', tab === button));
		if (button.dataset.mode === 'upload') $('#transcriptFile').click();
		if (button.dataset.mode === 'record') {
			if (recorder?.state === 'recording') return recorder.stop();
			if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Live recording is not supported by this browser');
			navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
				recordingStream = stream;
				recorder = new MediaRecorder(stream);
				recordingChunks = [];
				recorder.addEventListener('dataavailable', (event) => { if (event.data.size) recordingChunks.push(event.data); });
				recorder.addEventListener('stop', async () => {
					const recording = new File(recordingChunks, `meeting-${Date.now()}.webm`, { type: recorder.mimeType || 'audio/webm' });
					recordingStream?.getTracks().forEach((track) => track.stop());
					recordingStream = null;
					try { await transcribeFile(recording, transcript, status); toast('Recording transcribed'); }
					catch (error) { status.textContent = error.message; toast(error.message); }
				});
				recorder.start();
				status.textContent = 'Recording... select Live recording again to stop.';
				toast('Recording started');
			}).catch(() => toast('Microphone access was not available'));
		}
	}));
	$('#transcriptFile').addEventListener('change', async (event) => {
		const file = event.target.files?.[0];
		if (!file) return;
		const audio = /\.(mp3|m4a|wav|webm|mp4|mpeg|mpga|oga)$/i.test(file.name);
		try {
			if (audio) await transcribeFile(file, transcript, status);
			else {
				transcript.value = await file.text();
				transcript.dispatchEvent(new Event('input'));
				status.textContent = `${file.name} loaded.`;
			}
			toast(audio ? 'Audio transcription complete' : `${file.name} loaded`);
		} catch (error) { status.textContent = error.message; toast(error.message); }
	});
	$('#generateButton').addEventListener('click', async () => {
		const text = transcript.value.trim();
		if (!text) return toast('Add a transcript first');
		const button = $('#generateButton');
		button.disabled = true;
		button.innerHTML = '<span>…</span> Analyzing transcript';
		try {
			const response = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ transcript: text }) });
			const result = await response.json();
			if (!response.ok) throw new Error(result.error || 'AI analysis failed');
			preview = result;
			$('#resultContent').innerHTML = `<p>${escapeHtml(preview.summary)}</p>`;
			$('#actionResult').innerHTML = preview.actionItems.length ? `<ul>${preview.actionItems.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p class="empty-result">No action items identified.</p>';
			$('#decisionResult').innerHTML = preview.decisions.length ? `<ul>${preview.decisions.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p class="empty-result">No decisions identified.</p>';
			$('#clarificationResult').innerHTML = preview.clarifications.length ? `<ul>${preview.clarifications.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p class="empty-result">No clarifications identified.</p>';
			$('#topicList').innerHTML = preview.topics.length ? preview.topics.map((item) => `<li>${escapeHtml(item)}</li>`).join('') : '<li>No key topics identified.</li>';
			toast('AI meeting insights generated');
		} catch (error) { toast(error.message); }
		finally { button.disabled = false; button.innerHTML = '<span>✦</span> Generate Meeting Insights'; }
	});
	document.querySelectorAll('[data-results-tab]').forEach((button) => button.addEventListener('click', () => {
		activeResultsTab = button.dataset.resultsTab;
		document.querySelectorAll('.result-tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.resultsTab === activeResultsTab));
		const results = {
			Summary: preview?.summary ? `<p>${escapeHtml(preview.summary)}</p>` : '<p class="empty-result">Your meeting summary will appear here after analysis.</p>',
			'Action Items': preview?.actionItems?.length ? `<ul>${preview.actionItems.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p class="empty-result">Action items will appear after analysis.</p>',
			Decisions: preview?.decisions?.length ? `<ul>${preview.decisions.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p class="empty-result">Decisions will appear after analysis.</p>',
			Clarifications: preview?.clarifications?.length ? `<ul>${preview.clarifications.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p class="empty-result">Clarifications will appear after analysis.</p>',
			Transcript: `<p>${escapeHtml(transcript.value.trim() || 'Your transcript will appear here.')}</p>`
		};
		$('#resultContent').innerHTML = results[activeResultsTab] || results.Summary;
	}));
	$('#copySummary').addEventListener('click', async () => {
		try { await navigator.clipboard.writeText(preview?.summary || ''); toast(preview?.summary ? 'Summary copied to clipboard' : 'Generate a preview first'); }
		catch { toast('Clipboard access is unavailable'); }
	});
	$('#saveButton').addEventListener('click', async () => {
		const title = $('#meetingTitle').value.trim();
		if (!title) return toast('Add a meeting title before saving');
		const payload = {
			title,
			date: $('#meetingDate').value,
			mode: $('#meetingMode').value,
			participants: $('#meetingParticipants').value.split(',').map((name) => name.trim()).filter(Boolean),
			transcript: transcript.value.trim(),
			summary: preview?.summary ?? '',
			actionItems: preview?.actionItems ?? [],
			decisions: preview?.decisions ?? [],
			clarifications: preview?.clarifications ?? [],
			topics: preview?.topics ?? []
		};
		try {
			const response = await fetch('/api/meetings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
			if (!response.ok) throw new Error('Could not save meeting');
			const meeting = await response.json();
			location.href = `Meetings.html?id=${encodeURIComponent(meeting.id)}`;
		} catch (error) { toast(`${error.message}. Start the local server with node server.js`); }
	});
}

let meetingData = [];
let selectedMeetingId = null;
let activeTab = 'Summary';
let activeFilter = 'all';

function renderMeetingDetail(meeting) {
	const panel = $('#meetingDetail');
	if (!meeting) {
		panel.innerHTML = '<div class="empty-detail"><span class="detail-mark">▣</span><h2>Select a meeting</h2><p>Meeting summary, participants and follow-ups will appear here.</p></div>';
		return;
	}
	const participants = meeting.participants || [];
	const tabs = ['Summary', 'Action Items', 'Decisions', 'Clarifications', 'Transcript'];
	const listForTab = activeTab === 'Action Items' ? meeting.actionItems : activeTab === 'Decisions' ? meeting.decisions : activeTab === 'Clarifications' ? meeting.clarifications : [];
	let body = '';
	if (activeTab === 'Summary') body = `<article class="summary-card"><div class="summary-card-head"><strong><span class="result-icon purple">▤</span>Meeting Summary</strong><button class="quiet-action" id="copyMeeting" type="button">▢ Copy</button></div><p>${escapeHtml(meeting.summary || 'No summary has been saved for this meeting.')}</p></article>`;
	if (['Action Items', 'Decisions', 'Clarifications'].includes(activeTab)) body = `<article class="summary-card"><div class="summary-card-head"><strong>${escapeHtml(activeTab)}</strong></div>${listForTab?.length ? `<ul>${listForTab.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>No items saved.</p>'}</article>`;
	if (activeTab === 'Transcript') body = `<article class="summary-card"><div class="summary-card-head"><strong>Transcript</strong></div><p>${escapeHtml(meeting.transcript || 'No transcript saved.')}</p></article>`;
	panel.innerHTML = `<div class="detail-content"><div class="detail-top"><div><h2>${escapeHtml(meeting.title)}</h2><div class="detail-date">▣ &nbsp; ${escapeHtml(formatMeetingDate(meeting))}</div></div><button class="detail-edit" id="editMeetingTitle" type="button">✎ Edit</button></div><div class="detail-people"><div class="detail-people-head"><span class="detail-label">Participants (${participants.length})</span><button class="text-link" id="viewParticipants" type="button">View All</button></div><div class="people-chips">${participants.slice(0, 5).map((name) => `<span class="avatar-chip" title="${escapeHtml(name)}">${escapeHtml(initials(name))}</span>`).join('')}${participants.length > 5 ? `<span class="avatar-chip add-person">+${participants.length - 5}</span>` : '<button class="avatar-chip add-person" id="addParticipant" type="button" aria-label="Add participant">Add</button>'}</div></div><div class="detail-tabs" role="tablist">${tabs.map((tab) => `<button class="detail-tab ${activeTab === tab ? 'active' : ''}" data-detail-tab="${escapeHtml(tab)}" type="button">${escapeHtml(tab)}</button>`).join('')}</div><div class="detail-body">${body}</div>${activeTab === 'Summary' ? `<div class="meeting-metrics"><div class="meeting-metric"><span class="meeting-metric-icon">✓</span><strong>${meeting.actionItems?.length ?? 0}</strong><small>Action Items</small></div><div class="meeting-metric"><span class="meeting-metric-icon">♙</span><strong>${meeting.decisions?.length ?? 0}</strong><small>Key Decisions</small></div><div class="meeting-metric"><span class="meeting-metric-icon">?</span><strong>${meeting.clarifications?.length ?? 0}</strong><small>Clarifications</small></div><div class="meeting-metric"><span class="meeting-metric-icon">♣</span><strong>${participants.length}</strong><small>Participants</small></div></div>` : ''}<div class="meeting-detail-lower"><section class="detail-subpanel"><div class="detail-subhead"><span>ϟ &nbsp; Quick Actions</span></div><div class="quick-actions"><a class="quick-action open-dashboard" href="homepage.html">▣ &nbsp; Open in Dashboard</a><button class="quick-action" id="exportPdf" type="button">▣ &nbsp; Export as PDF</button><button class="quick-action" id="exportCsv" type="button">▤ &nbsp; Export as CSV</button><button class="quick-action delete-meeting" id="deleteMeeting" type="button">⌫</button></div></section><section class="detail-subpanel"><div class="detail-subhead"><span>▤ &nbsp; Notes</span><button class="add-note" id="addNote" type="button">☷ &nbsp; Add Note</button></div><div style="padding:7px"><textarea class="notes-input" id="noteInput" placeholder="Add your notes about this meeting...">${escapeHtml(meeting.notes || '')}</textarea></div></section></div></div>`;
	panel.querySelectorAll('[data-detail-tab]').forEach((button) => button.addEventListener('click', () => { activeTab = button.dataset.detailTab; renderMeetingDetail(meeting); }));
	$('#viewParticipants').addEventListener('click', () => toast(`${participants.length} participants in this meeting`));
	$('#addParticipant')?.addEventListener('click', () => toast('Add participants when editing this meeting'));
	$('#copyMeeting')?.addEventListener('click', async () => {
		try { await navigator.clipboard.writeText(meeting.summary || meeting.transcript || ''); toast('Summary copied to clipboard'); }
		catch { toast('Clipboard access is unavailable'); }
	});
	$('#editMeetingTitle').addEventListener('click', async () => {
		const title = prompt('Meeting title', meeting.title);
		if (!title?.trim()) return;
		await updateMeeting(meeting.id, { title: title.trim() });
		toast('Meeting title updated');
	});
	$('#addNote').addEventListener('click', async () => {
		try {
			await updateMeeting(meeting.id, { notes: $('#noteInput').value.trim() });
			toast('Note saved');
		} catch { toast('Could not save note'); }
	});
	$('#exportPdf').addEventListener('click', () => window.print());
	$('#exportCsv').addEventListener('click', () => {
		const value = (meeting.actionItems || []).map((item) => `"${item.replaceAll('"', '""')}"`).join('\n');
		const link = document.createElement('a');
		link.href = URL.createObjectURL(new Blob([`Action Item\n${value}`], { type: 'text/csv' }));
		link.download = `${meeting.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-actions.csv`;
		link.click();
		URL.revokeObjectURL(link.href);
	});
	$('#deleteMeeting').addEventListener('click', async () => {
		if (!confirm(`Delete “${meeting.title}”?`)) return;
		const response = await fetch(`/api/meetings/${encodeURIComponent(meeting.id)}`, { method: 'DELETE' });
		if (!response.ok) return toast('Could not delete meeting');
		meetingData = meetingData.filter((item) => item.id !== meeting.id);
		selectedMeetingId = meetingData[0]?.id ?? null;
		renderMeetings();
		toast('Meeting deleted');
	});
}

async function updateMeeting(id, changes) {
	const response = await fetch(`/api/meetings/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changes) });
	if (!response.ok) throw new Error('Could not update meeting');
	const updated = await response.json();
	meetingData = meetingData.map((meeting) => meeting.id === id ? updated : meeting);
	renderMeetings();
	return updated;
}

function visibleMeetings() {
	const query = ($('#meetingSearch').value || $('#globalSearch').value).trim().toLowerCase();
	const now = new Date();
	return meetingData.filter((meeting) => {
		const searchable = `${meeting.title} ${(meeting.participants || []).join(' ')} ${meeting.summary || ''} ${(meeting.actionItems || []).join(' ')} ${(meeting.decisions || []).join(' ')}`.toLowerCase();
		if (query && !searchable.includes(query)) return false;
		if (activeFilter === 'all' || !meeting.date) return true;
		const date = new Date(meeting.date);
		if (Number.isNaN(date.valueOf())) return false;
		if (activeFilter === 'week') return date >= new Date(now.getTime() - 7 * 86400000) && date <= now;
		if (activeFilter === 'year') return date.getFullYear() === now.getFullYear();
		return date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
	});
}

function renderMeetings() {
	const meetings = visibleMeetings();
	$('#meetingTotal').textContent = String(meetingData.length);
	const actionCount = meetingData.reduce((sum, meeting) => sum + (meeting.actionItems?.length ?? 0), 0);
	$('#actionTotal').textContent = String(actionCount);
	$('#pendingTaskTotal').textContent = String(meetingData.reduce((sum, meeting) => sum + (meeting.pendingTasks ?? meeting.actionItems?.length ?? 0), 0));
	$('#participantTotal').textContent = String(new Set(meetingData.flatMap((meeting) => meeting.participants || [])).size);
	const avatarColors = ['#8547ef', '#ed5d77', '#7644e8', '#6b74ed', '#8866a8'];
	$('#meetingList').innerHTML = meetings.length ? meetings.map((meeting, index) => {
		const people = meeting.participants || [];
		const avatars = people.slice(0, 3).map((name, personIndex) => `<span class="avatar" style="background:${avatarColors[personIndex % avatarColors.length]}" title="${escapeHtml(name)}">${escapeHtml(initials(name))}</span>`).join('');
		const extraPeople = people.length > 3 ? `<span class="more-count">+${people.length - 3}</span>` : '';
		return `<button class="meeting-row ${meeting.id === selectedMeetingId ? 'selected' : ''}" data-meeting-id="${escapeHtml(meeting.id)}" type="button"><span class="row-icon">${index % 3 === 1 ? '◈' : '▣'}</span><span class="row-copy"><strong>${escapeHtml(meeting.title)}</strong><small>${escapeHtml(formatMeetingDate(meeting))}</small><span class="meeting-avatars">${avatars}${extraPeople}</span></span><span class="row-metrics"><span title="Action items">☷ ${meeting.actionItems?.length ?? 0}</span><span title="Decisions">♙ ${meeting.decisions?.length ?? 0}</span><span title="Participants">♣ ${people.length}</span></span></button>`;
	}).join('') : '<div class="empty-list">No meetings match. Create a meeting to get started.</div>';
	$('#meetingList').querySelectorAll('[data-meeting-id]').forEach((button) => button.addEventListener('click', () => {
		selectedMeetingId = button.dataset.meetingId;
		activeTab = 'Summary';
		renderMeetings();
	}));
	renderMeetingDetail(meetingData.find((meeting) => meeting.id === selectedMeetingId));
}

async function initMeetings() {
	try {
		const response = await fetch('/api/meetings');
		if (!response.ok) {
			const result = await response.json();
			throw new Error(result.error || 'Could not load meetings');
		}
		meetingData = await response.json();
		const requestedId = new URLSearchParams(location.search).get('id');
		selectedMeetingId = meetingData.find((meeting) => meeting.id === requestedId)?.id ?? meetingData[0]?.id ?? null;
	} catch (error) { toast(error.message); }
	$('#meetingSearch').addEventListener('input', renderMeetings);
	$('#globalSearch').addEventListener('input', renderMeetings);
	document.querySelectorAll('.filter-tab').forEach((button) => button.addEventListener('click', () => {
		activeFilter = button.dataset.filter;
		document.querySelectorAll('.filter-tab').forEach((tab) => tab.classList.toggle('active', tab === button));
		renderMeetings();
	}));
	renderMeetings();
}

document.addEventListener('DOMContentLoaded', () => {
	if (location.pathname.endsWith('Meetings.html')) initMeetings();
	else initNewMeeting();
	document.querySelectorAll('[data-local-only]').forEach((button) => button.addEventListener('click', () => toast(`${button.textContent.trim()} is outside this two-page workspace`)));
	document.addEventListener('keydown', (event) => {
		if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			$('#globalSearch')?.focus();
		}
	});
});