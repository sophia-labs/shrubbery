-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Garden-native workspace and document navigation. Device paths never enter
-- this surface: folders and parentage come directly from Garden navigation.

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
local RULE = Blitbuffer.COLOR_GRAY_B
local WASH = Blitbuffer.COLOR_GRAY_E
local ROWS_PER_PAGE = 6

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

local function sameParent(value, parent_id)
    local value_parent = value.parentId
    if value_parent == nil or value_parent == "" then value_parent = nil end
    return value_parent == parent_id
end

local TreeRow = InputContainer:extend{
    width = nil,
    height = nil,
    title = "",
    meta = "",
    kind = "document",
    callback = nil,
}

function TreeRow:init()
    self.dimen = Geom:new{ w = self.width, h = self.height }
    self.ges_events.Tap = { GestureRange:new{ ges = "tap", range = self.dimen } }
    local padding = math.floor(self.width * 0.035)
    local inner = Geom:new{ w = self.width - padding * 2, h = self.height }
    local title = (self.kind == "folder" and "▱  " or "") .. (self.title ~= "" and self.title or "Untitled")
    local copy = VerticalGroup:new{
        align = "left",
        TextWidget:new{
            text = self.meta,
            face = Font:getFace("NotoSans-Bold.ttf", 10),
            fgcolor = QUIET,
            max_width = inner.w - 34,
        },
        spacer(4),
        TextWidget:new{
            text = title,
            face = Font:getFace(
                self.kind == "folder" and "NotoSerif-Bold.ttf" or "NotoSerif-Regular.ttf",
                self.kind == "folder" and 18 or 17
            ),
            fgcolor = INK,
            max_width = inner.w - 34,
        },
    }
    self.frame = FrameContainer:new{
        width = self.width,
        height = self.height,
        padding = 0,
        padding_left = padding,
        padding_right = padding,
        bordersize = 0,
        radius = 0,
        background = self.kind == "folder" and WASH or PAPER,
        OverlapGroup:new{
            dimen = inner,
            LeftContainer:new{ dimen = inner:copy(), copy },
            RightContainer:new{
                dimen = inner:copy(),
                TextWidget:new{
                    text = "›",
                    face = Font:getFace("NotoSerif-Regular.ttf", 24),
                    fgcolor = QUIET,
                },
            },
        },
    }
    self[1] = self.frame
end

function TreeRow:onTap()
    if self.callback then self.callback() end
    return true
end

function TreeRow:onFocus()
    self.frame.invert = true
    UIManager:setDirty(self.show_parent or self, "ui", self.dimen)
    return true
end

function TreeRow:onUnfocus()
    self.frame.invert = false
    UIManager:setDirty(self.show_parent or self, "ui", self.dimen)
    return true
end

local SophiaBrowse = FocusManager:extend{
    plugin = nil,
    manifest = nil,
    active_folder_id = nil,
    page = 1,
}

function SophiaBrowse:folderById(id)
    local folders = self.manifest and self.manifest.navigation and self.manifest.navigation.folders
    if type(folders) ~= "table" then return nil end
    for _, folder in ipairs(folders) do
        if tostring(folder.id) == tostring(id) then return folder end
    end
end

function SophiaBrowse:folderItemCount(folder_id)
    local count = 0
    local folders = self.manifest and self.manifest.navigation and self.manifest.navigation.folders or {}
    local documents = self.manifest and self.manifest.documents or {}
    for _, folder in ipairs(folders) do
        if sameParent(folder, folder_id) then count = count + 1 end
    end
    for _, document in ipairs(documents) do
        if sameParent(document, folder_id) then count = count + 1 end
    end
    return count
end

function SophiaBrowse:entries()
    local entries = {}
    local folders = self.manifest and self.manifest.navigation and self.manifest.navigation.folders or {}
    local documents = self.manifest and self.manifest.documents or {}
    for _, folder in ipairs(folders) do
        if sameParent(folder, self.active_folder_id) then
            table.insert(entries, { kind = "folder", value = folder })
        end
    end
    table.sort(entries, function(left, right)
        local left_order = tonumber(left.value.order) or 0
        local right_order = tonumber(right.value.order) or 0
        if left_order ~= right_order then return left_order < right_order end
        return tostring(left.value.label) < tostring(right.value.label)
    end)
    local pages = {}
    for _, document in ipairs(documents) do
        if sameParent(document, self.active_folder_id) then
            table.insert(pages, { kind = "document", value = document })
        end
    end
    table.sort(pages, function(left, right)
        return tostring(left.value.title or left.value.id) < tostring(right.value.title or right.value.id)
    end)
    for _, entry in ipairs(pages) do table.insert(entries, entry) end
    return entries
end

function SophiaBrowse:init()
    self.dimen = Geom:new{ w = Screen:getWidth(), h = Screen:getHeight() }
    self.covers_fullscreen = true
    self.layout = {}
    if Device:hasKeys() then self.key_events.Close = { { Input.group.Back } } end
    if Device:isTouchDevice() then
        self.ges_events.Swipe = { GestureRange:new{ ges = "swipe", range = self.dimen } }
    end

    local margin = math.floor(self.dimen.w * 0.075)
    local content_width = self.dimen.w - margin * 2
    local library = self.manifest and self.manifest.library or {}
    local workspace = library.title or library.graphId or "Your garden"
    local graph_id = library.graphId or "offline"
    local active_folder = self:folderById(self.active_folder_id)
    if self.active_folder_id and not active_folder then self.active_folder_id = nil end
    local entries = self:entries()
    local page_count = math.max(1, math.ceil(#entries / ROWS_PER_PAGE))
    self.page = math.max(1, math.min(tonumber(self.page) or 1, page_count))
    local first = (self.page - 1) * ROWS_PER_PAGE + 1
    local last = math.min(#entries, first + ROWS_PER_PAGE - 1)

    local utility_left = TextWidget:new{
        text = "SOPHIA / BROWSE",
        face = Font:getFace("NotoSans-Bold.ttf", 11),
        fgcolor = QUIET,
    }
    local utility_right = TextWidget:new{
        text = string.upper(tostring(graph_id)),
        face = Font:getFace("NotoSans-Regular.ttf", 10),
        fgcolor = QUIET,
        max_width = math.floor(content_width * 0.48),
    }
    local gap = math.max(12, content_width - utility_left:getSize().w - utility_right:getSize().w)
    local body = VerticalGroup:new{
        align = "left",
        spacer(26),
        HorizontalGroup:new{ utility_left, HorizontalSpan:new{ width = gap }, utility_right },
        spacer(18),
        TextWidget:new{
            text = "Browse",
            face = Font:getFace("NotoSerif-Regular.ttf", 38),
            fgcolor = INK,
        },
        spacer(5),
        TextWidget:new{
            text = "Garden folders and pages",
            face = Font:getFace("NotoSerif-Italic.ttf", 16),
            fgcolor = QUIET,
        },
        spacer(18),
    }

    local workspace_row = TreeRow:new{
        width = content_width,
        height = 70,
        title = workspace,
        meta = "WORKSPACE  ·  TAP TO SWITCH",
        kind = "folder",
        show_parent = self,
        callback = function() self.plugin:chooseWorkspace() end,
    }
    table.insert(body, workspace_row)
    table.insert(self.layout, { workspace_row })
    table.insert(body, spacer(18))

    if active_folder then
        local parent_id = active_folder.parentId
        local up = TreeRow:new{
            width = content_width,
            height = 58,
            title = "Back to " .. (parent_id and (self:folderById(parent_id) or {}).label or workspace),
            meta = "PARENT FOLDER",
            kind = "folder",
            show_parent = self,
            callback = function() self.plugin:showBrowse(parent_id, 1) end,
        }
        table.insert(body, up)
        table.insert(body, rule(content_width))
        table.insert(self.layout, { up })
    end

    if #entries == 0 then
        table.insert(body, centered(
            Geom:new{ w = content_width, h = 180 },
            TextWidget:new{
                text = active_folder and "This Garden folder is empty." or "No pages are gathered here yet.",
                face = Font:getFace("NotoSerif-Italic.ttf", 18),
                fgcolor = QUIET,
            }
        ))
    else
        for index = first, last do
            local item = entries[index]
            local value = item.value
            local selected = value
            local row = TreeRow:new{
                width = content_width,
                height = 64,
                title = item.kind == "folder" and value.label or value.title,
                meta = item.kind == "folder"
                    and ("FOLDER  ·  " .. tostring(self:folderItemCount(value.id)) .. " ITEMS")
                    or ("PAGE  ·  REV " .. tostring(value.revision or "—")),
                kind = item.kind,
                show_parent = self,
                callback = item.kind == "folder"
                    and function() self.plugin:showBrowse(selected.id, 1) end
                    or function() self.plugin:openDocument(selected) end,
            }
            table.insert(body, row)
            table.insert(body, rule(content_width))
            table.insert(self.layout, { row })
        end
    end

    if page_count > 1 then
        local previous = Button:new{
            text = "‹  PREVIOUS",
            width = math.floor(content_width / 2),
            height = 44,
            enabled = self.page > 1,
            bordersize = 0,
            callback = function() self.plugin:showBrowse(self.active_folder_id, self.page - 1) end,
            show_parent = self,
        }
        local next_page = Button:new{
            text = "NEXT  ›  " .. tostring(self.page) .. "/" .. tostring(page_count),
            width = content_width - math.floor(content_width / 2),
            height = 44,
            enabled = self.page < page_count,
            bordersize = 0,
            callback = function() self.plugin:showBrowse(self.active_folder_id, self.page + 1) end,
            show_parent = self,
        }
        table.insert(body, HorizontalGroup:new{ previous, next_page })
        table.insert(self.layout, { previous, next_page })
    end

    local footer_content, nav_buttons = SophiaNav.build{
        width = content_width,
        active = "browse",
        plugin = self.plugin,
        parent = self,
        status = tostring(#entries) .. " ITEMS IN THIS LOCATION  ·  GARDEN TREE",
    }
    table.insert(self.layout, nav_buttons)
    local footer = BottomContainer:new{ dimen = self.dimen:copy(), footer_content }
    self[1] = FrameContainer:new{
        width = self.dimen.w,
        height = self.dimen.h,
        padding = 0,
        bordersize = 0,
        background = PAPER,
        OverlapGroup:new{
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
        },
    }
end

function SophiaBrowse:onShow()
    UIManager:setDirty(self, "full")
end

function SophiaBrowse:onSwipe(_, gesture)
    if gesture.direction == "south" then return self:onClose() end
    if gesture.direction == "west" then
        self.plugin:showBrowse(self.active_folder_id, self.page + 1)
        return true
    end
    if gesture.direction == "east" then
        self.plugin:showBrowse(self.active_folder_id, self.page - 1)
        return true
    end
    return false
end

function SophiaBrowse:onClose()
    UIManager:close(self)
    if self.plugin then self.plugin:onBrowseClosed(self) end
    UIManager:setDirty(nil, "full")
    return true
end

function SophiaBrowse:onReturn()
    if self.active_folder_id then
        local folder = self:folderById(self.active_folder_id)
        self.plugin:showBrowse(folder and folder.parentId or nil, 1)
        return true
    end
    return self:onClose()
end

return SophiaBrowse
