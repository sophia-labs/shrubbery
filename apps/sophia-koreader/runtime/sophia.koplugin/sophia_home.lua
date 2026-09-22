-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Sophia's native e-ink home. This intentionally does not imitate a web app:
-- it translates the Garden/Shrubbery design grammar into KOReader primitives
-- (serif hierarchy, botanical bookplate, quiet rules, utility labels and
-- paper-like whitespace) while retaining native e-ink input and refresh.

local Blitbuffer = require("ffi/blitbuffer")
local BottomContainer = require("ui/widget/container/bottomcontainer")
local Button = require("ui/widget/button")
local CenterContainer = require("ui/widget/container/centercontainer")
local Device = require("device")
local FocusManager = require("ui/widget/focusmanager")
local Font = require("ui/font")
local FrameContainer = require("ui/widget/container/framecontainer")
local Geom = require("ui/geometry")
local GestureRange = require("ui/gesturerange")
local HorizontalGroup = require("ui/widget/horizontalgroup")
local HorizontalSpan = require("ui/widget/horizontalspan")
local IconWidget = require("ui/widget/iconwidget")
local InputContainer = require("ui/widget/container/inputcontainer")
local LeftContainer = require("ui/widget/container/leftcontainer")
local LineWidget = require("ui/widget/linewidget")
local OverlapGroup = require("ui/widget/overlapgroup")
local RightContainer = require("ui/widget/container/rightcontainer")
local TextWidget = require("ui/widget/textwidget")
local UIManager = require("ui/uimanager")
local VerticalGroup = require("ui/widget/verticalgroup")
local VerticalSpan = require("ui/widget/verticalspan")

local SophiaNav = require("sophia_nav")

local Input = Device.input
local Screen = Device.screen

local INK = Blitbuffer.COLOR_BLACK
local PAPER = Blitbuffer.COLOR_WHITE
local QUIET = Blitbuffer.COLOR_DARK_GRAY
local WASH = Blitbuffer.COLOR_GRAY_E
local RULE = Blitbuffer.COLOR_GRAY_B

local FACE_DISPLAY = "NotoSerif-Regular.ttf"
local FACE_DISPLAY_BOLD = "NotoSerif-Bold.ttf"
local FACE_UTILITY = "NotoSans-Regular.ttf"
local FACE_UTILITY_BOLD = "NotoSans-Bold.ttf"

local function spacer(height)
    return VerticalSpan:new{ width = height }
end

local function rule(width, color)
    return LineWidget:new{
        dimen = Geom:new{ w = width, h = 1 },
        background = color or RULE,
    }
end

local function centered(dimen, widget)
    return CenterContainer:new{ dimen = dimen, widget }
end

local function uppercase(value)
    return string.upper(tostring(value or ""))
end

local SophiaRow = InputContainer:extend{
    width = nil,
    height = nil,
    title = "",
    meta = "",
    callback = nil,
    highlighted = false,
}

function SophiaRow:init()
    self.dimen = Geom:new{ w = self.width, h = self.height }
    self.ges_events.Tap = {
        GestureRange:new{ ges = "tap", range = self.dimen },
    }
    self.ges_events.Hold = {
        GestureRange:new{ ges = "hold", range = self.dimen },
    }

    local horizontal_padding = math.floor(self.width * 0.035)
    local chevron_width = 34
    local text_width = self.width - horizontal_padding * 2 - chevron_width
    local title_size = self.highlighted and 22 or 19
    local title_face = self.highlighted and FACE_DISPLAY_BOLD or FACE_DISPLAY

    local copy = VerticalGroup:new{
        align = "left",
        TextWidget:new{
            text = self.meta,
            face = Font:getFace(FACE_UTILITY_BOLD, 11),
            fgcolor = QUIET,
            max_width = text_width,
        },
        spacer(5),
        TextWidget:new{
            text = self.title ~= "" and self.title or "Untitled",
            face = Font:getFace(title_face, title_size),
            fgcolor = INK,
            max_width = text_width,
        },
    }

    local inner = Geom:new{
        w = self.width - horizontal_padding * 2,
        h = self.height,
    }
    local content = OverlapGroup:new{
        dimen = inner,
        LeftContainer:new{ dimen = inner:copy(), copy },
        RightContainer:new{
            dimen = inner:copy(),
            TextWidget:new{
                text = "›",
                face = Font:getFace(FACE_DISPLAY, 26),
                fgcolor = QUIET,
            },
        },
    }

    self.frame = FrameContainer:new{
        width = self.width,
        height = self.height,
        padding = 0,
        padding_left = horizontal_padding,
        padding_right = horizontal_padding,
        bordersize = 0,
        inner_bordersize = self.highlighted and 1 or 0,
        radius = 0,
        color = self.highlighted and RULE or PAPER,
        background = self.highlighted and WASH or PAPER,
        content,
    }
    self[1] = self.frame
end

function SophiaRow:onTap()
    if self.callback then self.callback() end
    return true
end

function SophiaRow:onHold()
    return self:onTap()
end

function SophiaRow:onFocus()
    self.frame.invert = true
    UIManager:setDirty(self.show_parent or self, "ui", self.dimen)
    return true
end

function SophiaRow:onUnfocus()
    self.frame.invert = false
    UIManager:setDirty(self.show_parent or self, "ui", self.dimen)
    return true
end

local SophiaHome = FocusManager:extend{
    plugin = nil,
    manifest = nil,
    last_sync_at = nil,
    last_document_id = nil,
}

function SophiaHome:documents()
    local documents = {}
    if self.manifest and type(self.manifest.documents) == "table" then
        for _, entry in ipairs(self.manifest.documents) do
            table.insert(documents, entry)
        end
    end
    table.sort(documents, function(left, right)
        local left_updated = tostring(left.updatedAt or "")
        local right_updated = tostring(right.updatedAt or "")
        if left_updated ~= right_updated then return left_updated > right_updated end
        return tostring(left.title or left.id) < tostring(right.title or right.id)
    end)
    return documents
end

function SophiaHome:continueEntry(documents)
    if self.last_document_id then
        for _, entry in ipairs(documents) do
            if tostring(entry.id) == tostring(self.last_document_id) then return entry end
        end
    end
    return documents[1]
end

function SophiaHome:sectionLabel(label, detail, width)
    local label_widget = TextWidget:new{
        text = uppercase(label),
        face = Font:getFace(FACE_UTILITY_BOLD, 11),
        fgcolor = QUIET,
    }
    local detail_widget = TextWidget:new{
        text = uppercase(detail),
        face = Font:getFace(FACE_UTILITY, 10),
        fgcolor = QUIET,
    }
    local occupied = label_widget:getSize().w + detail_widget:getSize().w + 28
    local line_width = math.max(20, width - occupied)
    return HorizontalGroup:new{
        align = "center",
        label_widget,
        HorizontalSpan:new{ width = 12 },
        rule(line_width),
        HorizontalSpan:new{ width = 12 },
        detail_widget,
    }
end

function SophiaHome:init()
    self.dimen = Geom:new{ w = Screen:getWidth(), h = Screen:getHeight() }
    self.covers_fullscreen = true
    self.layout = {}

    if Device:hasKeys() then
        self.key_events.Close = { { Input.group.Back } }
    end
    if Device:isTouchDevice() then
        self.ges_events.Swipe = {
            GestureRange:new{ ges = "swipe", range = self.dimen },
        }
    end

    local margin = math.floor(self.dimen.w * 0.075)
    local content_width = self.dimen.w - margin * 2
    local documents = self:documents()
    local continue_entry = self:continueEntry(documents)
    local library = self.manifest and self.manifest.library or {}
    local workspace = library.title or library.graphId or self.plugin.local_title or "Your garden"
    local graph_id = library.graphId or "offline"
    local sync_label = self.last_sync_at
        and ("SYNCED " .. tostring(self.last_sync_at):sub(-5)) or "NOT YET SYNCED"

    local utility_left = TextWidget:new{
        text = "SOPHIA / READER",
        face = Font:getFace(FACE_UTILITY_BOLD, 11),
        fgcolor = QUIET,
    }
    local utility_right = TextWidget:new{
        text = uppercase(graph_id),
        face = Font:getFace(FACE_UTILITY, 10),
        fgcolor = QUIET,
        max_width = math.floor(content_width * 0.48),
    }
    local utility_gap = math.max(
        12,
        content_width - utility_left:getSize().w - utility_right:getSize().w
    )
    local utility = HorizontalGroup:new{
        utility_left,
        HorizontalSpan:new{ width = utility_gap },
        utility_right,
    }

    local mark_size = 42
    local bookplate_rule_width = math.floor((content_width - mark_size - 30) / 2)
    local bookplate = HorizontalGroup:new{
        align = "center",
        rule(bookplate_rule_width),
        HorizontalSpan:new{ width = 15 },
        IconWidget:new{
            file = self.plugin.path .. "/resources/sophia-sprout.svg",
            width = mark_size,
            height = mark_size,
            alpha = true,
        },
        HorizontalSpan:new{ width = 15 },
        rule(bookplate_rule_width),
    }

    local title_block = VerticalGroup:new{
        centered(
            Geom:new{ w = content_width, h = 26 },
            TextWidget:new{
                text = uppercase(workspace),
                face = Font:getFace(FACE_UTILITY_BOLD, 11),
                fgcolor = QUIET,
                max_width = content_width,
            }
        ),
        spacer(3),
        centered(
            Geom:new{ w = content_width, h = 68 },
            TextWidget:new{
                text = "Sophia",
                face = Font:getFace(FACE_DISPLAY, 44),
                fgcolor = INK,
            }
        ),
    }

    local body = VerticalGroup:new{
        align = "left",
        spacer(28),
        utility,
        spacer(30),
        bookplate,
        spacer(10),
        title_block,
        spacer(26),
    }

    local sync_button = Button:new{
        text = "SYNC GARDEN",
        width = math.floor(content_width / 2),
        height = 44,
        bordersize = 0,
        radius = 0,
        text_font_face = FACE_UTILITY_BOLD,
        text_font_size = 11,
        callback = function() self.plugin:onSophiaSync() end,
        show_parent = self,
    }
    local settings_button = Button:new{
        text = "SETTINGS",
        width = content_width - math.floor(content_width / 2),
        height = 44,
        bordersize = 0,
        radius = 0,
        text_font_face = FACE_UTILITY_BOLD,
        text_font_size = 11,
        callback = function() self.plugin:editSettings() end,
        show_parent = self,
    }
    table.insert(body, HorizontalGroup:new{ sync_button, settings_button })
    table.insert(body, spacer(18))
    table.insert(self.layout, { sync_button, settings_button })

    if continue_entry then
        local continue_row = SophiaRow:new{
            width = content_width,
            height = 88,
            title = continue_entry.title,
            meta = "CONTINUE READING  ·  REV " .. tostring(continue_entry.revision or "—"),
            highlighted = true,
            show_parent = self,
            callback = function() self.plugin:openDocument(continue_entry) end,
        }
        table.insert(body, continue_row)
        table.insert(self.layout, { continue_row })
        table.insert(body, spacer(30))
    else
        local gather_row = SophiaRow:new{
            width = content_width,
            height = 88,
            title = "Gather this garden",
            meta = "NO PAGES CACHED",
            highlighted = true,
            show_parent = self,
            callback = function() self.plugin:onSophiaSync() end,
        }
        table.insert(body, gather_row)
        table.insert(self.layout, { gather_row })
        table.insert(body, spacer(30))
    end

    table.insert(body, self:sectionLabel("In this garden", tostring(#documents) .. " pages", content_width))
    table.insert(body, spacer(10))

    local visible_count = math.min(#documents, 4)
    for index = 1, visible_count do
        local entry = documents[index]
        local row = SophiaRow:new{
            width = content_width,
            height = 76,
            title = entry.title,
            meta = "REV " .. tostring(entry.revision or "—") .. "  ·  CACHED FOR READING",
            show_parent = self,
            callback = function() self.plugin:openDocument(entry) end,
        }
        table.insert(body, row)
        table.insert(body, rule(content_width))
        table.insert(self.layout, { row })
    end

    if #documents == 0 then
        table.insert(body, centered(
            Geom:new{ w = content_width, h = 110 },
            TextWidget:new{
                text = "Your first pages will gather here.",
                face = Font:getFace("NotoSerif-Italic.ttf", 18),
                fgcolor = QUIET,
            }
        ))
    elseif #documents > visible_count then
        table.insert(body, centered(
            Geom:new{ w = content_width, h = 44 },
            TextWidget:new{
                text = "+ " .. tostring(#documents - visible_count) .. " MORE PAGES",
                face = Font:getFace(FACE_UTILITY_BOLD, 10),
                fgcolor = QUIET,
            }
        ))
    end

    local footer_content, nav_buttons = SophiaNav.build{
        width = content_width,
        active = "home",
        plugin = self.plugin,
        parent = self,
        status = sync_label .. "  ·  OFFLINE LIBRARY READY",
    }
    table.insert(self.layout, nav_buttons)
    local footer = BottomContainer:new{
        dimen = self.dimen:copy(),
        footer_content,
    }
    local content = OverlapGroup:new{
        dimen = self.dimen:copy(),
        FrameContainer:new{
            width = self.dimen.w,
            height = self.dimen.h,
            padding = 0,
            bordersize = 0,
            background = PAPER,
            CenterContainer:new{
                dimen = Geom:new{ w = self.dimen.w, h = body:getSize().h },
                body,
            },
        },
        footer,
    }

    self[1] = FrameContainer:new{
        width = self.dimen.w,
        height = self.dimen.h,
        padding = 0,
        bordersize = 0,
        background = PAPER,
        content,
    }
end

function SophiaHome:onShow()
    UIManager:setDirty(self, "full")
end

function SophiaHome:onSwipe(_, gesture)
    if gesture.direction == "south" then return self:onClose() end
    return false
end

function SophiaHome:onClose()
    UIManager:close(self)
    if self.plugin then self.plugin:onHomeClosed(self) end
    UIManager:setDirty(nil, "full")
    return true
end

function SophiaHome:onReturn()
    return self:onClose()
end

return SophiaHome
