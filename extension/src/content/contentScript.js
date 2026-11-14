/**
 * WikiBridge Minimal Wikipedia Content Script
 * Locates the exact differing, unsourced, or emotional passage inside the Wikipedia DOM,
 * scrolls smoothly to it, highlights the exact differing part in red (#fee7e6 / #d33),
 * and displays a concise inline note.
 */

(() => {
  if (window.__WIKIBRIDGE_CONTENT_READY__) return;
  window.__WIKIBRIDGE_CONTENT_READY__ = true;

  function clearExistingHighlights() {
    document.querySelectorAll('mark.wikibridge-disputed-highlight').forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    });

    document.querySelectorAll('.wikibridge-paragraph-focus').forEach((el) => {
      el.classList.remove('wikibridge-paragraph-focus');
    });

    document.querySelectorAll('.wikibridge-inline-note').forEach((note) => {
      note.remove();
    });
  }

  function normalizeText(str) {
    return (str || '')
      .replace(/\u00ad/g, '')
      .replace(/[\u2012-\u2015\u2212]/g, '-')
      .replace(/[\u00a0\s]+/g, ' ')
      .replace(/\[\d+\]/g, '')
      .replace(/\.{3}$/, '')
      .trim();
  }

  function wrapRangeWithHighlightMarks(range) {
    const root = range.commonAncestorContainer;
    if (root.nodeType === Node.TEXT_NODE) {
      const textNode = root;
      const selectedText = textNode.textContent.slice(range.startOffset, range.endOffset);
      if (!selectedText.trim()) return null;

      const mark = document.createElement('mark');
      mark.className = 'wikibridge-disputed-highlight';
      const splitTarget = textNode.splitText(range.startOffset);
      splitTarget.splitText(range.endOffset - range.startOffset);
      mark.textContent = splitTarget.textContent;
      splitTarget.parentNode.replaceChild(mark, splitTarget);
      return mark;
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const segments = [];
    let current;
    while ((current = walker.nextNode())) {
      if (!range.intersectsNode(current)) continue;
      if (!current.textContent || !current.textContent.trim()) continue;
      const parentTag = current.parentElement ? current.parentElement.tagName : '';
      if (parentTag === 'SUP' || parentTag === 'STYLE' || parentTag === 'SCRIPT') continue;

      const start = current === range.startContainer ? range.startOffset : 0;
      const end =
        current === range.endContainer ? range.endOffset : current.textContent.length;
      if (end > start) {
        segments.push({ node: current, start, end });
      }
    }

    let firstMark = null;
    for (const seg of segments) {
      const mark = document.createElement('mark');
      mark.className = 'wikibridge-disputed-highlight';
      const targetPart = seg.node.splitText(seg.start);
      targetPart.splitText(seg.end - seg.start);
      mark.textContent = targetPart.textContent;
      targetPart.parentNode.replaceChild(mark, targetPart);
      if (!firstMark) firstMark = mark;
    }
    return firstMark;
  }

  function highlightSubstringInElement(containerEl, rawSnippet) {
    const cleanTarget = normalizeText(rawSnippet).toLowerCase();
    if (!cleanTarget || cleanTarget.length < 3) return null;

    const walker = document.createTreeWalker(containerEl, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parentTag = node.parentElement ? node.parentElement.tagName : '';
        if (parentTag === 'SUP' || parentTag === 'STYLE' || parentTag === 'SCRIPT') {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    const charMap = [];
    let normalizedConcat = '';
    let prevWasSpace = false;

    let textNode;
    while ((textNode = walker.nextNode())) {
      const val = textNode.textContent || '';
      for (let i = 0; i < val.length; i++) {
        let ch = val[i];
        if (ch === '\u00ad') continue;
        if (/[\u2012-\u2015\u2212]/.test(ch)) ch = '-';
        const isSpace = /\s|\u00a0/.test(ch);
        if (isSpace) {
          if (!prevWasSpace && normalizedConcat.length > 0) {
            normalizedConcat += ' ';
            charMap.push({ node: textNode, offset: i });
            prevWasSpace = true;
          }
        } else {
          normalizedConcat += ch.toLowerCase();
          charMap.push({ node: textNode, offset: i });
          prevWasSpace = false;
        }
      }
    }

    const matchIdx = normalizedConcat.indexOf(cleanTarget);
    if (matchIdx === -1) return null;

    const startEntry = charMap[matchIdx];
    const endEntry = charMap[Math.min(charMap.length - 1, matchIdx + cleanTarget.length - 1)];
    if (!startEntry || !endEntry) return null;

    const range = document.createRange();
    range.setStart(startEntry.node, startEntry.offset);
    range.setEnd(endEntry.node, endEntry.offset + 1);

    return wrapRangeWithHighlightMarks(range);
  }

  function findBestMatchingBlock(discrepancy) {
    const contentRoot =
      document.querySelector('#mw-content-text .mw-parser-output') ||
      document.querySelector('#mw-content-text') ||
      document.body;

    const blocks = Array.from(contentRoot.querySelectorAll('p, li, dd, td, blockquote')).filter(
      (el) => (el.textContent || '').trim().length >= 18
    );

    const snippet = normalizeText(discrepancy.disputedSnippet || '');
    const phrase = normalizeText(discrepancy.highlightPhrase || '');

    if (snippet) {
      const normSnippet = snippet.toLowerCase();

      // 1. Full normalized sentence match
      for (const block of blocks) {
        const normBlock = normalizeText(block.textContent || '').toLowerCase();
        if (normBlock.includes(normSnippet)) {
          return { block, subPhrase: normSnippet };
        }
      }

      // 2. Clause match (split at commas/semicolons/dashes)
      const clauses = normSnippet
        .split(/[,;—]/)
        .map((c) => c.trim())
        .filter((c) => c.length >= 16);
      for (const clause of clauses) {
        for (const block of blocks) {
          const normBlock = normalizeText(block.textContent || '').toLowerCase();
          if (normBlock.includes(clause)) {
            return { block, subPhrase: clause };
          }
        }
      }

      // 3. Sliding 4-word phrase match
      const words = normSnippet.split(' ').filter(Boolean);
      if (words.length >= 3) {
        const winLen = Math.min(4, words.length);
        for (let i = 0; i <= words.length - winLen; i++) {
          const win = words.slice(i, i + winLen).join(' ');
          for (const block of blocks) {
            const normBlock = normalizeText(block.textContent || '').toLowerCase();
            if (normBlock.includes(win)) {
              return { block, subPhrase: win };
            }
          }
        }
      }

      // 4. Token + numeric overlap match
      const targetTokens = words.filter((w) => w.length >= 3);
      let bestBlock = null;
      let bestScore = 0;

      for (const block of blocks) {
        const textLower = normalizeText(block.textContent || '').toLowerCase();
        let hits = 0;
        for (const tok of targetTokens) {
          if (textLower.includes(tok)) {
            hits += /\d/.test(tok) ? 2.5 : 1;
          }
        }
        const score = targetTokens.length > 0 ? hits / targetTokens.length : 0;
        if (score > bestScore && score >= 0.3) {
          bestScore = score;
          bestBlock = block;
        }
      }

      if (bestBlock) {
        return { block: bestBlock, subPhrase: null };
      }
    }

    // 5. Direct highlightPhrase match anywhere in content
    if (phrase && phrase.length >= 3) {
      const phraseLower = phrase.toLowerCase();
      for (const block of blocks) {
        const normBlock = normalizeText(block.textContent || '').toLowerCase();
        if (normBlock.includes(phraseLower)) {
          return { block, subPhrase: phraseLower };
        }
      }
    }

    // 6. Section heading fallback
    if (discrepancy.sectionHeading) {
      const targetSec = discrepancy.sectionHeading.toLowerCase();
      const headings = Array.from(contentRoot.querySelectorAll('h2, h3, .mw-heading'));
      const matchedHeading = headings.find((h) =>
        (h.textContent || '').toLowerCase().includes(targetSec)
      );
      if (matchedHeading && matchedHeading.nextElementSibling) {
        return { block: matchedHeading.nextElementSibling, subPhrase: null };
      }
    }

    return { block: blocks[0] || contentRoot, subPhrase: null };
  }

  function renderMinimalInlineNote(anchorEl, discrepancy) {
    const note = document.createElement('div');
    note.className = 'wikibridge-inline-note';

    const top = document.createElement('div');
    top.className = 'wikibridge-inline-note-top';

    const headingWrap = document.createElement('div');
    headingWrap.className = 'wikibridge-inline-note-heading';

    const badge = document.createElement('span');
    badge.className = 'wikibridge-inline-badge';
    badge.textContent = discrepancy.issueLabel || 'Discrepancy';

    const title = document.createElement('span');
    title.className = 'wikibridge-inline-note-title';
    title.textContent = discrepancy.claimTopic || 'Flagged passage';

    headingWrap.appendChild(badge);
    headingWrap.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'wikibridge-inline-close';
    closeBtn.title = 'Dismiss highlight';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => clearExistingHighlights());

    top.appendChild(headingWrap);
    top.appendChild(closeBtn);
    note.appendChild(top);

    const body = document.createElement('p');
    body.className = 'wikibridge-inline-note-body';
    body.textContent = discrepancy.summary || discrepancy.suggestedCorrection || '';
    note.appendChild(body);

    anchorEl.insertAdjacentElement('afterend', note);
  }

  function applyDiscrepancyHighlight(discrepancy) {
    clearExistingHighlights();
    const match = findBestMatchingBlock(discrepancy);
    const block = match.block;
    if (!block) return { highlighted: false };

    // Prefer highlighting the exact differing phrase/word when available,
    // falling back to the matched sentence/clause or full paragraph focus.
    let markEl = null;
    if (discrepancy.highlightPhrase) {
      markEl = highlightSubstringInElement(block, discrepancy.highlightPhrase);
    }
    if (!markEl && (match.subPhrase || discrepancy.disputedSnippet)) {
      markEl = highlightSubstringInElement(
        block,
        match.subPhrase || discrepancy.disputedSnippet
      );
    }

    if (!markEl) {
      block.classList.add('wikibridge-paragraph-focus');
    }

    renderMinimalInlineNote(block, discrepancy);

    const scrollTarget = markEl || block;
    scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });

    return { highlighted: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== 'APPLY_DISCREPANCY_HIGHLIGHT') return false;
    const res = applyDiscrepancyHighlight(message.discrepancy);
    sendResponse(res);
    return false;
  });
})();
