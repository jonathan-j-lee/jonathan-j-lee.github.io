#!/usr/bin/env python

import PIL.Image
import PIL.ImageDraw

WIDTH = HEIGHT = 64
SIZE, SPACE = 18, 5


def main():
    img = PIL.Image.new('RGBA', (WIDTH, HEIGHT))
    draw = PIL.ImageDraw.Draw(img)

    red = 'rgb(224, 96, 64)'
    green = 'rgb(64, 224, 128)'
    blue = 'rgb(64, 128, 224)'

    colors = [[green, red, blue],
              [red, blue, green],
              [blue, green, red]]

    for i, x in enumerate(range(0, WIDTH, SIZE + SPACE)):
        for j, y in enumerate(range(0, HEIGHT, SIZE + SPACE)):
            bounds = [(x, y), ((x + SIZE), (y + SIZE))]
            draw.rectangle(bounds, fill=colors[i][j])

    img.save('assets/img/favicon.png')


if __name__ == '__main__':
    main()
