-- SPDX-License-Identifier: AGPL-3.0-or-later

local Blitbuffer = require("ffi/blitbuffer")
local Button = require("ui/widget/button")
local CenterContainer = require("ui/widget/container/centercontainer")
local Font = require("ui/font")
local Geom = require("ui/geometry")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local LineWidget = require("ui/widget/linewidget")
local TextWidget = require("ui/widget/textwidget")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")

local Nav = {}

function Nav.build(options)
    local width = options.width
    local half = math.floor(width / 2)
    local active = options.active
    local home = Button:new{
        text = active == "home" and "●  HOME" or "○  HOME",
        width = half,
        height = 54,
        bordersize = 0,
        radius = 0,
        text_font_face = "NotoSans-Bold.ttf",
        text_font_size = 13,
        callback = function() options.plugin:showHome() end,
        show_parent = options.parent,
    }
    local browse = Button:new{
        text = active == "browse" and "●  BROWSE" or "○  BROWSE",
        width = width - half,
        height = 54,
        bordersize = 0,
        radius = 0,
        text_font_face = "NotoSans-Bold.ttf",
        text_font_size = 13,
        callback = function() options.plugin:showBrowse() end,
        show_parent = options.parent,
    }
    local rule = LineWidget:new{
        dimen = Geom:new{ w = width, h = 1 },
        background = Blitbuffer.COLOR_BLACK,
    }
    local status = CenterContainer:new{
        dimen = Geom:new{ w = width, h = 28 },
        TextWidget:new{
            text = options.status or "GARDEN LIBRARY",
            face = Font:getFace("NotoSans-Regular.ttf", 9),
            fgcolor = Blitbuffer.COLOR_DARK_GRAY,
            max_width = width,
        },
    }
    return VerticalGroup:new{
        rule,
        HorizontalGroup:new{ home, browse },
        status,
        VerticalSpan:new{ width = 10 },
    }, { home, browse }
end

return Nav
