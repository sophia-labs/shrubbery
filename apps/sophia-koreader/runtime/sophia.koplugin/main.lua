-- SPDX-License-Identifier: AGPL-3.0-or-later
--
-- Sophia for KOReader — a native e-ink home for Shrubbery's packaged KOReader
-- target. Shrubbery renders semantic XHTML and JSON sidecars; this plugin owns
-- the Sophia home, settings, incremental synchronization, offline cache and
-- handing local XHTML to KOReader's document engine. KOReader retains
-- pagination, fonts, dictionaries, bookmarks, highlights and reading position.

local DataStorage = require("datastorage")
local Dispatcher = require("dispatcher")
local ButtonDialog = require("ui/widget/buttondialog")
local InfoMessage = require("ui/widget/infomessage")
local LuaSettings = require("luasettings")
local MultiInputDialog = require("ui/widget/multiinputdialog")
local NetworkMgr = require("ui/network/manager")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local filemanagerutil = require("apps/filemanager/filemanagerutil")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local _ = require("gettext")

local Client = require("sophia_client")
local SophiaBrowse = require("sophia_browse")
local SophiaHome = require("sophia_home")
local Store = require("sophia_store")

local MANIFEST_SCHEMA = "urn:sophia:shrubbery:koreader:manifest:v0.1"
local MANIFEST_VERSION = 1
local PROJECTION_VERSION = 6
local WORKSPACE_CATALOGUE_SCHEMA = "urn:sophia:shrubbery:koreader:workspaces:v0.1"
local WORKSPACE_CATALOGUE_VERSION = 1
local STARTUP_HOME_FLAG = "__sophia_koreader_home_shown"

local function trim(value)
    return value:match("^%s*(.-)%s*$") or ""
end

local Sophia = WidgetContainer:extend{
    name = "sophia",
    settings_file = DataStorage:getSettingsDir() .. "/sophia.lua",
    settings = nil,
    updated = false,
    store = nil,
    manifest = nil,
    workspace_catalogue = nil,
    workspace_manifest_path = "manifest.json",
    feed_url = "",
    bearer_token = "",
    local_title = "Sophia",
    last_sync_at = nil,
    last_document_id = nil,
    open_home_on_startup = true,
    home_widget = nil,
    browse_widget = nil,
}

function Sophia:init()
    self:loadSettings()
    self.store = Store:new()
    self.manifest = self.store:readManifest()
    self.workspace_catalogue = self.store:readWorkspaceCatalogue()
    self:onDispatcherRegisterActions()
    self.ui.menu:registerToMainMenu(self)
    if self.open_home_on_startup and not rawget(_G, STARTUP_HOME_FLAG) then
        rawset(_G, STARTUP_HOME_FLAG, true)
        UIManager:scheduleIn(0.35, function()
            if self.ui and not self.home_widget then self:showHome() end
        end)
    end
end

function Sophia:loadSettings()
    if not Sophia.settings then
        Sophia.settings = LuaSettings:open(self.settings_file)
    end
    self.settings = Sophia.settings
    local config = self.settings:readSetting("sophia", {})
    self.feed_url = config.feed_url or ""
    self.bearer_token = config.bearer_token or ""
    self.local_title = config.local_title or "Sophia"
    self.last_sync_at = config.last_sync_at
    self.last_document_id = config.last_document_id
    self.workspace_manifest_path = config.workspace_manifest_path or "manifest.json"
    self.open_home_on_startup = config.open_home_on_startup ~= false
end

function Sophia:onFlushSettings()
    if not self.updated then return end
    self.settings:saveSetting("sophia", {
        feed_url = self.feed_url,
        bearer_token = self.bearer_token,
        local_title = self.local_title,
        last_sync_at = self.last_sync_at,
        last_document_id = self.last_document_id,
        workspace_manifest_path = self.workspace_manifest_path,
        open_home_on_startup = self.open_home_on_startup,
    })
    self.settings:flush()
    self.updated = false
end

function Sophia:onDispatcherRegisterActions()
    Dispatcher:registerAction("sophia_sync", {
        category = "none",
        event = "SophiaSync",
        title = _("Synchronize Sophia"),
        general = true,
    })
    Dispatcher:registerAction("sophia_home", {
        category = "none",
        event = "SophiaHome",
        title = _("Open Sophia"),
        general = true,
    })
    Dispatcher:registerAction("sophia_browse", {
        category = "none",
        event = "SophiaBrowse",
        title = _("Browse Sophia"),
        general = true,
    })
end

function Sophia:addToMainMenu(menu_items)
    menu_items.sophia = {
        text = _("Sophia"),
        sorting_hint = "more_tools",
        sub_item_table_func = function()
            return self:getMainMenuItems()
        end,
    }
end

function Sophia:getMainMenuItems()
    return {
        {
            text = _("Open Sophia"),
            callback = function() self:showHome() end,
        },
        {
            text = _("Browse Garden"),
            callback = function() self:showBrowse() end,
        },
        {
            text = _("Sync Garden"),
            callback = function() self:onSophiaSync() end,
        },
        {
            text = _("Settings"),
            keep_menu_open = true,
            callback = function() self:editSettings() end,
        },
        {
            text = self:statusText(),
            enabled = false,
            separator = true,
        },
        {
            text = _("Open library index"),
            enabled_func = function()
                return lfs.attributes(self.store:indexPath(), "mode") == "file"
            end,
            callback = function() self:openIndex() end,
        },
        {
            text = self:libraryTitle(),
            sub_item_table_func = function()
                return self:getDocumentMenuItems()
            end,
        },
    }
end

function Sophia:getDocumentMenuItems()
    local documents = self.manifest and self.manifest.documents
    if type(documents) ~= "table" or #documents == 0 then
        return {
            {
                text = _("No cached documents. Use Sync Garden."),
                enabled = false,
            },
        }
    end

    local sorted = {}
    for _, entry in ipairs(documents) do table.insert(sorted, entry) end
    table.sort(sorted, function(left, right)
        local left_updated = left.updatedAt or ""
        local right_updated = right.updatedAt or ""
        if left_updated ~= right_updated then return left_updated > right_updated end
        return tostring(left.title or left.id) < tostring(right.title or right.id)
    end)

    local items = {}
    for _, entry in ipairs(sorted) do
        table.insert(items, {
            text = tostring(entry.title or entry.id or _("Untitled")),
            callback = function() self:openDocument(entry) end,
            hold_callback = function()
                UIManager:show(InfoMessage:new{ text = self:documentDescription(entry) })
            end,
        })
    end
    return items
end

function Sophia:libraryTitle()
    if self.manifest and self.manifest.library and self.manifest.library.title then
        return tostring(self.manifest.library.title)
    end
    return self.local_title ~= "" and self.local_title or _("Library")
end

function Sophia:statusText()
    local count = self.manifest and type(self.manifest.documents) == "table"
        and #self.manifest.documents or 0
    if self.last_sync_at then
        return string.format(_("%d cached · synced %s"), count, self.last_sync_at)
    end
    return string.format(_("%d cached · never synced"), count)
end

function Sophia:documentDescription(entry)
    local parts = {
        tostring(entry.title or entry.id or _("Untitled")),
        string.format(_("Revision %s"), tostring(entry.revision or "?")),
    }
    if entry.updatedAt then table.insert(parts, tostring(entry.updatedAt)) end
    if entry.snippet then table.insert(parts, "\n" .. tostring(entry.snippet)) end
    return table.concat(parts, "\n")
end

function Sophia:editSettings()
    self.settings_dialog = MultiInputDialog:new{
        title = _("Sophia settings"),
        fields = {
            {
                text = self.feed_url,
                hint = _("Manifest URL (…/manifest.json)"),
            },
            {
                text = self.bearer_token,
                text_type = "password",
                hint = _("Bearer token (optional)"),
            },
            {
                text = self.local_title,
                hint = _("Local library label"),
            },
        },
        buttons = {
            {
                {
                    text = _("Cancel"),
                    id = "close",
                    callback = function() UIManager:close(self.settings_dialog) end,
                },
                {
                    text = _("Apply"),
                    is_enter_default = true,
                    callback = function()
                        local fields = self.settings_dialog:getFields()
                        local feed_url = trim(fields[1] or "")
                        if feed_url ~= "" and not feed_url:match("^https?://") then
                            UIManager:show(InfoMessage:new{
                                text = _("Manifest URL must begin with http:// or https://"),
                            })
                            return
                        end
                        if feed_url ~= self.feed_url then
                            self.workspace_manifest_path = "manifest.json"
                        end
                        self.feed_url = feed_url
                        self.bearer_token = trim(fields[2] or "")
                        self.local_title = trim(fields[3] or "")
                        self.updated = true
                        self:onFlushSettings()
                        UIManager:close(self.settings_dialog)
                        if self.home_widget then self:showHome() end
                    end,
                },
            },
        },
    }
    UIManager:show(self.settings_dialog)
    self.settings_dialog:onShowKeyboard()
end

function Sophia:onSophiaSync()
    if self.feed_url == "" then
        UIManager:show(InfoMessage:new{ text = _("Configure a Sophia manifest URL first.") })
        self:editSettings()
        return true
    end
    NetworkMgr:runWhenOnline(function() self:synchronize() end)
    return true
end

function Sophia:synchronize()
    local info = InfoMessage:new{ text = _("Synchronizing Sophia…") }
    UIManager:show(info)

    local root_ok, root_or_error = Client.fetchJSON(self.feed_url, self.bearer_token)
    if not root_ok then
        UIManager:close(info)
        self:showSyncError(root_or_error)
        return false
    end
    local root_manifest = root_or_error
    local valid, validation_error = self:validateManifest(root_manifest)
    if not valid then
        UIManager:close(info)
        self:showSyncError(validation_error)
        return false
    end

    local catalogue_url = Client.resolve(self.feed_url, root_manifest.workspaceCataloguePath)
    if not catalogue_url then
        UIManager:close(info)
        self:showSyncError(_("Could not resolve the workspace catalogue URL."))
        return false
    end
    local catalogue_ok, catalogue_or_error = Client.fetchJSON(catalogue_url, self.bearer_token)
    if not catalogue_ok then
        UIManager:close(info)
        self:showSyncError(catalogue_or_error)
        return false
    end
    local catalogue = catalogue_or_error
    local catalogue_valid, catalogue_error = self:validateWorkspaceCatalogue(catalogue)
    if not catalogue_valid then
        UIManager:close(info)
        self:showSyncError(catalogue_error)
        return false
    end

    local selected_path = self.workspace_manifest_path or "manifest.json"
    local selected_exists = false
    for _, workspace in ipairs(catalogue.workspaces) do
        if workspace.manifestPath == selected_path then selected_exists = true end
    end
    if not selected_exists then
        selected_path = "manifest.json"
        self.workspace_manifest_path = selected_path
    end
    local active_manifest_url = Client.resolve(self.feed_url, selected_path)
    if not active_manifest_url then
        UIManager:close(info)
        self:showSyncError(_("Could not resolve the selected workspace URL."))
        return false
    end
    local manifest = root_manifest
    if selected_path ~= "manifest.json" then
        local selected_ok, selected_or_error = Client.fetchJSON(active_manifest_url, self.bearer_token)
        if not selected_ok then
            UIManager:close(info)
            self:showSyncError(selected_or_error)
            return false
        end
        manifest = selected_or_error
        valid, validation_error = self:validateManifest(manifest)
        if not valid then
            UIManager:close(info)
            self:showSyncError(validation_error)
            return false
        end
    end

    local old_entries = {}
    if self.manifest and type(self.manifest.documents) == "table" then
        for _, entry in ipairs(self.manifest.documents) do
            if entry.id then
                local key = tostring(entry.graphId or "") .. "\0" .. tostring(entry.id)
                old_entries[key] = entry
            end
        end
    end
    local projection_changed = not self.manifest
        or self.manifest.projectionVersion ~= manifest.projectionVersion

    local updated_count = 0
    for _, entry in ipairs(manifest.documents) do
        local key = tostring(entry.graphId or "") .. "\0" .. tostring(entry.id)
        local old = old_entries[key]
        local needs_download = projection_changed
            or not old
            or old.revision ~= entry.revision
            or old.fileName ~= entry.fileName
            or old.modelFileName ~= entry.modelFileName
            or not self.store:hasDocument(entry)
            or not self.store:hasModel(entry)
        if needs_download then
            local document_ok, document_error = self:downloadEntry(
                entry.path,
                self.store:documentPath(entry),
                "application/xhtml+xml, text/html;q=0.9",
                active_manifest_url
            )
            if not document_ok then
                UIManager:close(info)
                self:showSyncError(document_error)
                return false
            end
            local model_ok, model_error = self:downloadEntry(
                entry.modelPath,
                self.store:modelPath(entry),
                "application/json",
                active_manifest_url
            )
            if not model_ok then
                UIManager:close(info)
                self:showSyncError(model_error)
                return false
            end
            updated_count = updated_count + 1
        end
    end

    local index_ok, index_error = self:downloadEntry(
        manifest.library.indexPath,
        self.store:indexPath(),
        "application/xhtml+xml, text/html;q=0.9",
        active_manifest_url
    )
    if not index_ok then
        UIManager:close(info)
        self:showSyncError(index_error)
        return false
    end

    -- Activate the new manifest only after every referenced local file and the
    -- workspace catalogue are durable.
    local catalogue_written, catalogue_write_error = self.store:writeWorkspaceCatalogue(catalogue)
    if not catalogue_written then
        UIManager:close(info)
        self:showSyncError(catalogue_write_error)
        return false
    end
    local written, write_error = self.store:writeManifest(manifest)
    if not written then
        UIManager:close(info)
        self:showSyncError(write_error)
        return false
    end

    self.manifest = manifest
    self.workspace_catalogue = catalogue
    self.last_sync_at = os.date("%Y-%m-%d %H:%M")
    self.updated = true
    self:onFlushSettings()
    UIManager:close(info)
    self:refreshCurrentSurface()
    UIManager:show(InfoMessage:new{
        text = string.format(
            _("Sophia synchronized: %d documents, %d updated."),
            #manifest.documents,
            updated_count
        ),
        timeout = 4,
    })
    return true
end

function Sophia:downloadEntry(relative_path, local_path, accept, manifest_url)
    local remote_url = Client.resolve(manifest_url or self.feed_url, relative_path)
    if not remote_url then return false, _("Could not resolve a feed URL.") end
    return Client.download(remote_url, self.bearer_token, local_path, accept)
end

function Sophia:validateManifest(manifest)
    if type(manifest) ~= "table" then
        return false, _("Manifest is not an object.")
    end
    if manifest.schema ~= MANIFEST_SCHEMA
        or manifest.version ~= MANIFEST_VERSION
        or manifest.projectionVersion ~= PROJECTION_VERSION then
        return false, _("Manifest schema or version is unsupported.")
    end
    if type(manifest.library) ~= "table"
        or type(manifest.library.id) ~= "string"
        or type(manifest.library.graphId) ~= "string"
        or type(manifest.library.title) ~= "string"
        or manifest.library.indexPath ~= "index.xhtml"
        or type(manifest.workspaceCataloguePath) ~= "string"
        or (
            manifest.workspaceCataloguePath ~= "workspaces.json"
            and manifest.workspaceCataloguePath ~= "../../workspaces.json"
        )
        or type(manifest.navigation) ~= "table"
        or type(manifest.navigation.folders) ~= "table"
        or type(manifest.documents) ~= "table" then
        return false, _("Manifest is missing a valid library or documents collection.")
    end

    local folder_ids = {}
    for index, folder in ipairs(manifest.navigation.folders) do
        if type(folder) ~= "table"
            or type(folder.id) ~= "string"
            or folder.id == ""
            or folder_ids[folder.id]
            or folder.graphId ~= manifest.library.graphId
            or type(folder.label) ~= "string"
            or type(folder.order) ~= "number"
            or (folder.parentId ~= nil and type(folder.parentId) ~= "string") then
            return false, string.format(_("Manifest folder %d is invalid."), index)
        end
        folder_ids[folder.id] = true
    end

    local ids = {}
    for index, entry in ipairs(manifest.documents) do
        if type(entry) ~= "table"
            or type(entry.id) ~= "string"
            or entry.id == ""
            or ids[entry.id]
            or type(entry.graphId) ~= "string"
            or entry.graphId ~= manifest.library.graphId
            or type(entry.title) ~= "string"
            or (entry.parentId ~= nil and type(entry.parentId) ~= "string")
            or type(entry.revision) ~= "number"
            or entry.revision < 0
            or entry.revision % 1 ~= 0
            or type(entry.path) ~= "string"
            or not entry.path:match("^documents/[A-Za-z0-9%._~%-]+%.xhtml$")
            or type(entry.modelPath) ~= "string"
            or not entry.modelPath:match("^models/[A-Za-z0-9%._~%-]+%.json$")
            or type(entry.fileName) ~= "string"
            or not entry.fileName:match("^[A-Za-z0-9%._~%-]+%.xhtml$")
            or type(entry.modelFileName) ~= "string"
            or not entry.modelFileName:match("^[A-Za-z0-9%._~%-]+%.json$") then
            return false, string.format(_("Manifest document %d is invalid."), index)
        end
        ids[entry.id] = true
    end
    return true
end

function Sophia:validateWorkspaceCatalogue(catalogue)
    if type(catalogue) ~= "table"
        or catalogue.schema ~= WORKSPACE_CATALOGUE_SCHEMA
        or catalogue.version ~= WORKSPACE_CATALOGUE_VERSION
        or type(catalogue.workspaces) ~= "table" then
        return false, _("Workspace catalogue schema or version is unsupported.")
    end
    local ids = {}
    for index, workspace in ipairs(catalogue.workspaces) do
        local path = type(workspace) == "table" and workspace.manifestPath or nil
        if type(workspace) ~= "table"
            or type(workspace.id) ~= "string"
            or workspace.id == ""
            or ids[workspace.id]
            or type(workspace.graphId) ~= "string"
            or type(workspace.title) ~= "string"
            or type(path) ~= "string"
            or path:find("..", 1, true)
            or not (
                path == "manifest.json"
                or path:match("^workspaces/[A-Za-z0-9%._~%-]+/manifest%.json$")
            ) then
            return false, string.format(_("Workspace catalogue entry %d is invalid."), index)
        end
        ids[workspace.id] = true
    end
    if #catalogue.workspaces == 0 then return false, _("Workspace catalogue is empty.") end
    return true
end

function Sophia:openIndex()
    local path = self.store:indexPath()
    if lfs.attributes(path, "mode") ~= "file" then
        UIManager:show(InfoMessage:new{ text = _("Library index is not cached yet.") })
        return
    end
    self:closeSurfaces()
    filemanagerutil.openFile(self.ui, path, nil, true)
end

function Sophia:openDocument(entry)
    local path = self.store:documentPath(entry)
    if lfs.attributes(path, "mode") ~= "file" then
        UIManager:show(InfoMessage:new{
            text = _("Document is not cached. Synchronize Sophia first."),
        })
        return
    end
    self.last_document_id = tostring(entry.id)
    self.updated = true
    self:onFlushSettings()
    logger.info(
        "Sophia opening cached document",
        tostring(entry.id),
        tostring(entry.title or ""),
        path
    )
    self:closeSurfaces()
    filemanagerutil.openFile(self.ui, path, nil, true)
end

function Sophia:showHome()
    self:closeBrowse()
    self:closeHome()
    local home = SophiaHome:new{
        plugin = self,
        manifest = self.manifest,
        last_sync_at = self.last_sync_at,
        last_document_id = self.last_document_id,
    }
    self.home_widget = home
    UIManager:show(home)
    return true
end

function Sophia:showBrowse(folder_id, page)
    self:closeHome()
    self:closeBrowse()
    local browse = SophiaBrowse:new{
        plugin = self,
        manifest = self.manifest,
        active_folder_id = folder_id,
        page = page or 1,
    }
    self.browse_widget = browse
    UIManager:show(browse)
    return true
end

function Sophia:closeHome()
    local home = self.home_widget
    if not home then return end
    self.home_widget = nil
    UIManager:close(home)
end

function Sophia:onHomeClosed(home)
    if self.home_widget == home then self.home_widget = nil end
end

function Sophia:closeBrowse()
    local browse = self.browse_widget
    if not browse then return end
    self.browse_widget = nil
    UIManager:close(browse)
end

function Sophia:onBrowseClosed(browse)
    if self.browse_widget == browse then self.browse_widget = nil end
end

function Sophia:closeSurfaces()
    self:closeHome()
    self:closeBrowse()
end

function Sophia:refreshCurrentSurface()
    if self.browse_widget then
        self:showBrowse()
    elseif self.home_widget then
        self:showHome()
    end
end

function Sophia:chooseWorkspace()
    local catalogue = self.workspace_catalogue
    if not catalogue or type(catalogue.workspaces) ~= "table" then
        UIManager:show(InfoMessage:new{
            text = _("Synchronize Sophia once to gather the workspace catalogue."),
        })
        return
    end
    local buttons = {}
    local title_counts = {}
    for _, workspace in ipairs(catalogue.workspaces) do
        local title = tostring(workspace.title)
        title_counts[title] = (title_counts[title] or 0) + 1
    end
    for _, workspace in ipairs(catalogue.workspaces) do
        local selected = workspace
        local current = selected.manifestPath == self.workspace_manifest_path
        local label = tostring(selected.title)
        if title_counts[label] > 1 then
            label = label .. "  ·  " .. tostring(selected.graphId)
        end
        table.insert(buttons, {
            {
                text = (current and "●  " or "○  ") .. label,
                callback = function()
                    UIManager:close(self.workspace_dialog)
                    self:selectWorkspace(selected)
                end,
            },
        })
    end
    self.workspace_dialog = ButtonDialog:new{
        title = _("Choose a Garden workspace"),
        buttons = buttons,
        rows_per_page = 7,
    }
    UIManager:show(self.workspace_dialog)
end

function Sophia:selectWorkspace(workspace)
    if workspace.manifestPath == self.workspace_manifest_path then
        self:showBrowse()
        return
    end
    self.workspace_manifest_path = workspace.manifestPath
    self.last_document_id = nil
    self.updated = true
    self:onFlushSettings()
    NetworkMgr:runWhenOnline(function() self:synchronize() end)
end

function Sophia:onSophiaHome()
    return self:showHome()
end

function Sophia:onSophiaBrowse()
    return self:showBrowse()
end

function Sophia:showSyncError(error_value)
    local message = tostring(error_value or _("Unknown synchronization error"))
    logger.err("Sophia synchronization failed:", message)
    UIManager:show(InfoMessage:new{
        text = _("Sophia synchronization failed:") .. "\n" .. message,
    })
end

return Sophia
