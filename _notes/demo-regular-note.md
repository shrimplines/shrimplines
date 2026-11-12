---
title: "[Demo] Regular note: image syntax"
date: 2026-10-20
category: thoughts
---


**This is a labeled example, not real writing. Delete this file when you no longer need it.** Everything below appears in exactly the order it is written in the Markdown source.

## A subheading

Ordinary paragraphs, *italics*, **bold**, and [links](https://example.com) all work as normal Markdown. Images go wherever you place the tag.

{% include img.html src="/assets/images/test/1.jpg" alt="First image" height=300 caption="One standalone image, height 300. Width follows the aspect ratio." %}

More paragraphs continue after the image. A second image can follow with a different height and no caption.

{% include img.html src="/assets/images/test/2.png" alt="Second image" height=360 %}

An explicit row of images, each with its own height. Equal heights read as one line.

<div class="note-group note-group--row">
{% include img.html src="/assets/images/test/2.png" alt="Second image" height=170 %}
{% include img.html src="/assets/images/test/3.png" alt="Third image" height=170 %}
{% include img.html src="/assets/images/test/4.png" alt="Fourth image" height=170 caption="Captions are optional per image." %}
</div>

Back to plain text, then the note ends.