# ⚡ Quiz Arena

A fast-paced, interactive web dev quiz app built with vanilla HTML, CSS, and JavaScript. Test your knowledge of HTML, CSS, PHP, SQL, XML, and React — beat the clock, chain streaks, and review your answers at the end.

![Node.js](https://img.shields.io/badge/Node.js-339933?logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?logo=express&logoColor=white)
![M-Pesa](https://img.shields.io/badge/M--Pesa-00A859?logo=safaricom&logoColor=white)
![AI](https://img.shields.io/badge/AI--Powered-7C3AED?logo=anthropic&logoColor=white)

---

## 🎮 Features

- **15-second timer** per question with animated countdown
- **Shuffled answer options** on every load — no memorizing positions
- **Streak system** — chain correct answers for bonus recognition
- **Keyboard navigation** — press `1`–`4` to pick, `Enter` to advance, `Escape` to exit
- **Answer review screen** — see every question, your choice, and the correct answer
- **Animated score ring** on results screen
- **Exit confirmation** — no accidental progress loss
- **Fully responsive** — works on mobile and desktop

---

## 🚀 Getting Started

### Run locally

No build tools or dependencies needed. Just open the file:

```bash
# Clone the repo
git clone https://github.com/jimmyurl/Quiz-App.git

# Open in your browser
cd Quiz-App
open index.html        # macOS
start index.html       # Windows
xdg-open index.html    # Linux
```

Or drag and drop `index.html` into any browser window.

### Run with Live Server (VS Code)

1. Install the [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) extension
2. Open the project folder in VS Code
3. Click **Go Live** in the bottom status bar
4. App opens at `http://127.0.0.1:5500`

---

## 📁 Project Structure

```
Quiz-App/
├── index.html        # Main app (single file — all HTML, CSS, JS)
├── assets/
│   ├── style.css     # Original styles (legacy)
│   └── js/
│       ├── quiz.js   # Question data
│       └── script.js # Quiz logic (legacy)
└── README.md
```

> The upgraded app lives in `index.html` as a self-contained single file.

---

## 🛠 Built With

- **HTML5** — semantic structure
- **CSS3** — custom properties, keyframe animations, responsive layout
- **Vanilla JavaScript** — no frameworks, no dependencies
- **Google Fonts** — Bebas Neue + DM Sans
- **Font Awesome 6** — icons

---

## 🎯 How to Play

1. Click **Start Quiz**
2. Read each question and pick an answer before time runs out
3. Chain correct answers to build a streak 🔥
4. See your full score and answer breakdown at the end
5. Click **Play Again** to beat your score

---

## 🌐 Live Demo

> Coming soon via GitHub Pages

To enable: go to **Settings → Pages → Source → main branch → / (root)** and save. Your app will be live at:

```
https://jimmyurl.github.io/Quiz-App
```

---

## 📝 Adding More Questions

Open `index.html` and find the `QUESTIONS` array near the top of the `<script>` tag:

```javascript
const QUESTIONS = [
  {
    question: "Your question here?",
    answer: "The correct answer",
    options: [
      "The correct answer",
      "Wrong option 1",
      "Wrong option 2",
      "Wrong option 3"
    ]
  },
  // add more objects here...
];
```

The app automatically adjusts the progress bar, score ring, and result screen for any number of questions.

---

## 🤝 Contributing

Pull requests are welcome! For major changes, please open an issue first.

1. Fork the repo
2. Create your branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m 'feat: add your feature'`
4. Push to the branch: `git push origin feature/your-feature`
5. Open a Pull Request

---

## 📄 License

MIT — free to use, modify, and distribute.

---

Made with ⚡ by [jimmyurl](https://github.com/jimmyurl)