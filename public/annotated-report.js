(() => {
  const configEl = document.getElementById('report-config')
  const config = configEl ? JSON.parse(configEl.textContent || '{}') : {}
  let saveTimer = null

  function status(text) {
    const el = document.getElementById('save-status')
    if (el) el.textContent = text
  }

  function relayoutComments(pageNumber) {
    const list = document.getElementById('comment-list-' + pageNumber)
    const img = document.querySelector('.exam-frame img[data-page="' + pageNumber + '"]')
    const frame = img?.closest('.exam-frame')
    if (!list || !img) return
    const cards = Array.from(list.querySelectorAll('.comment-card'))
    const placeholder = list.querySelector('.comment-placeholder')
    if (placeholder) placeholder.style.display = cards.length ? 'none' : 'block'
    if (frame) {
      frame.querySelectorAll('.guide-line.dynamic-guide').forEach((el) => el.remove())
      cards.forEach((card) => {
        const pct = Number(card.dataset.yPercent || 0)
        const line = document.createElement('div')
        line.className = 'guide-line dynamic-guide'
        line.style.top = Math.max(4, Math.min(96, pct)) + '%'
        line.innerHTML = '<span class="guide-dot"></span>'
        frame.appendChild(line)
      })
    }
    const height = img.clientHeight || 0
    list.style.minHeight = Math.max(height, cards.length ? 180 : 80) + 'px'
    cards.sort((a, b) => Number(a.dataset.yPercent || 0) - Number(b.dataset.yPercent || 0))
    let lastBottom = 0
    cards.forEach((card) => {
      const pct = Number(card.dataset.yPercent || 0)
      const idealCenter = Math.round((pct / 100) * height)
      const cardHeight = Math.max(card.offsetHeight || 0, 72)
      let top = Math.max(0, idealCenter - Math.round(cardHeight / 2))
      if (top < lastBottom + 6) top = lastBottom + 6
      if (top + cardHeight > height && height > 0) top = Math.max(lastBottom + 6, height - cardHeight)
      card.style.top = top + 'px'
      lastBottom = top + cardHeight
    })
    list.style.minHeight = Math.max(height, lastBottom + 16) + 'px'
  }

  function relayoutAllComments() {
    document.querySelectorAll('.comment-list[data-page]').forEach((list) => {
      relayoutComments(Number(list.dataset.page || '0'))
    })
  }

  function scheduleAutoSave() {
    status('Guardando cambios...')
    clearTimeout(saveTimer)
    saveTimer = setTimeout(saveReportEdits, 700)
  }

  function editComment(button) {
    const card = button.closest('.comment-card')
    const paragraph = card?.querySelector('p')
    if (!paragraph || card.querySelector('.comment-editor')) return
    const editor = document.createElement('textarea')
    editor.className = 'comment-editor'
    editor.value = paragraph.textContent.trim()
    paragraph.replaceWith(editor)
    button.textContent = 'Guardar'
    button.onclick = () => saveEditedComment(button)
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'mini-btn'
    cancel.textContent = 'Cancelar'
    cancel.onclick = () => cancelEditComment(cancel, paragraph.outerHTML)
    button.parentElement.appendChild(cancel)
  }

  function saveEditedComment(button) {
    const card = button.closest('.comment-card')
    const editor = card?.querySelector('.comment-editor')
    if (!editor) return
    const p = document.createElement('p')
    p.textContent = editor.value.trim() || 'Comentario vacío'
    editor.replaceWith(p)
    button.textContent = 'Editar'
    button.onclick = () => editComment(button)
    const extraButtons = Array.from(button.parentElement.querySelectorAll('.mini-btn')).filter((el) => el !== button)
    extraButtons.forEach((el) => el.remove())
    relayoutComments(Number(card.dataset.page || '0'))
    scheduleAutoSave()
  }

  function deleteComment(button) {
    const card = button.closest('.comment-card')
    const pageNumber = Number(card?.dataset.page || '0')
    if (card) card.remove()
    if (pageNumber) relayoutComments(pageNumber)
    scheduleAutoSave()
  }

  function cancelEditComment(button, paragraphHtml) {
    const card = button.closest('.comment-card')
    const editor = card?.querySelector('.comment-editor')
    if (editor) editor.outerHTML = paragraphHtml
    const editBtn = button.parentElement.querySelector('.mini-btn')
    if (editBtn) {
      editBtn.textContent = 'Editar'
      editBtn.onclick = () => editComment(editBtn)
    }
    button.remove()
    relayoutComments(Number(card?.dataset.page || '0'))
  }

  function addComment(pageNumber, yPercent = 50) {
    const list = document.getElementById('comment-list-' + pageNumber)
    if (!list) return
    const card = document.createElement('details')
    card.className = 'comment-card'
    card.dataset.page = String(pageNumber)
    card.dataset.yPercent = String(Math.round(yPercent))
    card.open = true
    card.innerHTML =
      '<summary>💬 Comentario nuevo</summary>' +
      '<textarea class="comment-editor" placeholder="Escribe aquí el comentario del profesor..."></textarea>' +
      '<div class="comment-actions">' +
      '<button class="mini-btn" type="button">Guardar comentario</button>' +
      '<button class="mini-btn" type="button">Eliminar</button>' +
      '</div>'
    list.insertBefore(card, list.lastElementChild)
    const buttons = card.querySelectorAll('.mini-btn')
    buttons[0].onclick = () => saveNewComment(buttons[0])
    buttons[1].onclick = () => deleteComment(buttons[1])
    relayoutComments(pageNumber)
  }

  function addCommentAtClick(event, pageNumber) {
    const rect = event.target.getBoundingClientRect()
    const yPercent = Math.round(((event.clientY - rect.top) / rect.height) * 100)
    addComment(pageNumber, yPercent)
  }

  function saveNewComment(button) {
    const card = button.closest('.comment-card')
    const editor = card?.querySelector('.comment-editor')
    if (!editor) return
    const p = document.createElement('p')
    p.textContent = editor.value.trim() || 'Comentario vacío'
    editor.replaceWith(p)
    button.textContent = 'Editar'
    button.onclick = () => editComment(button)
    const deleteBtn = button.parentElement.querySelectorAll('.mini-btn')[1]
    if (deleteBtn) deleteBtn.onclick = () => deleteComment(deleteBtn)
    relayoutComments(Number(card.dataset.page || '0'))
    scheduleAutoSave()
  }

  async function saveReportEdits() {
    status('Guardando...')
    try {
      const htmlContent = '<!DOCTYPE html>\n' + document.documentElement.outerHTML
      const res = await fetch('/api/save-custom-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dirName: config.dirName, filename: config.filename, htmlContent }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'No se pudo guardar')
      status('Informe guardado. Ya irá incluido en el ZIP.')
    } catch (e) {
      status('Error al guardar el informe.')
    }
  }

  function installClickComments() {
    document.querySelectorAll('.exam-frame img[data-page]').forEach((img) => {
      img.addEventListener('click', (event) => {
        const pageNumber = Number(img.dataset.page || '0')
        if (pageNumber) addCommentAtClick(event, pageNumber)
      })
    })
  }

  window.editComment = editComment
  window.deleteComment = deleteComment
  window.addComment = addComment
  window.addCommentAtClick = addCommentAtClick
  installClickComments()
  window.addEventListener('load', relayoutAllComments)
  window.addEventListener('resize', relayoutAllComments)
})();
