"""A changing fullscreen pattern for the private Linux capture integration test."""
import sys

from PySide6.QtCore import QTimer
from PySide6.QtGui import QColor, QPainter
from PySide6.QtWidgets import QApplication, QWidget


class Pattern(QWidget):
    def __init__(self):
        super().__init__()
        self.phase = 0
        self.setWindowTitle('PetPlay isolated capture pattern')
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.tick)
        self.timer.start(400)

    def tick(self):
        self.phase = 1 - self.phase
        self.update()

    def paintEvent(self, event):
        painter = QPainter(self)
        painter.fillRect(self.rect(), QColor('#ff0000'))
        painter.fillRect(self.width() // 2, 0, self.width() // 2, self.height(), QColor('#0000ff'))
        painter.fillRect(self.width() // 3, self.height() // 3,
                         self.width() // 3, self.height() // 3,
                         QColor('#00ff00' if self.phase else '#ffff00'))


app = QApplication(sys.argv)
widget = Pattern()
widget.showFullScreen()
sys.exit(app.exec())
