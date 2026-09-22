-- SPDX-License-Identifier: AGPL-3.0-or-later

local DataStorage = require("datastorage")
local JSON = require("json")
local ffiUtil = require("ffi/util")
local lfs = require("libs/libkoreader-lfs")
local util = require("util")

local Store = {}
Store.__index = Store

function Store:new()
    local data_root = ffiUtil.joinPath(DataStorage:getDataDir(), "data")
    local root = ffiUtil.joinPath(data_root, "sophia")
    local instance = setmetatable({
        root = root,
        documents_dir = ffiUtil.joinPath(root, "documents"),
        models_dir = ffiUtil.joinPath(root, "models"),
        index_path = ffiUtil.joinPath(root, "index.xhtml"),
        manifest_path = ffiUtil.joinPath(root, "manifest.json"),
        workspace_catalogue_path = ffiUtil.joinPath(root, "workspaces.json"),
    }, self)
    instance:ensure()
    return instance
end

function Store:ensure()
    util.makePath(self.root)
    util.makePath(self.documents_dir)
    util.makePath(self.models_dir)
end

function Store:readManifest()
    return self:readJSON(self.manifest_path)
end

function Store:writeManifest(manifest)
    return self:writeAtomic(self.manifest_path, JSON.encode(manifest))
end

function Store:readWorkspaceCatalogue()
    return self:readJSON(self.workspace_catalogue_path)
end

function Store:writeWorkspaceCatalogue(catalogue)
    return self:writeAtomic(self.workspace_catalogue_path, JSON.encode(catalogue))
end

function Store:documentPath(entry)
    local file_name = entry and entry.fileName
    if not self:isSafeFileName(file_name, "xhtml") then
        file_name = self:safeFileStem(entry and entry.id or "document") .. ".xhtml"
    end
    local graph = self:safeFileStem(entry and entry.graphId or "legacy")
    return ffiUtil.joinPath(self.documents_dir, graph .. "--" .. file_name)
end

function Store:modelPath(entry)
    local file_name = entry and entry.modelFileName
    if not self:isSafeFileName(file_name, "json") then
        file_name = self:safeFileStem(entry and entry.id or "document") .. ".json"
    end
    local graph = self:safeFileStem(entry and entry.graphId or "legacy")
    return ffiUtil.joinPath(self.models_dir, graph .. "--" .. file_name)
end

function Store:indexPath()
    return self.index_path
end

function Store:hasDocument(entry)
    return lfs.attributes(self:documentPath(entry), "mode") == "file"
end

function Store:hasModel(entry)
    return lfs.attributes(self:modelPath(entry), "mode") == "file"
end

function Store:readJSON(path)
    local file = io.open(path, "rb")
    if not file then return nil end
    local body = file:read("*a")
    file:close()
    if not body or body == "" then return nil end
    local ok, value = pcall(JSON.decode, body)
    if not ok then return nil end
    return value
end

function Store:writeAtomic(path, body)
    self:ensure()
    local temporary = path .. ".part"
    local file, err = io.open(temporary, "wb")
    if not file then return false, err end
    local ok, write_err = file:write(body)
    file:close()
    if not ok then
        os.remove(temporary)
        return false, write_err
    end
    local renamed, rename_err = os.rename(temporary, path)
    if not renamed then
        os.remove(temporary)
        return false, rename_err
    end
    return true
end

function Store:isSafeFileName(value, extension)
    return type(value) == "string"
        and value:match("^[A-Za-z0-9%._~%-]+%." .. extension .. "$") ~= nil
end

function Store:safeFileStem(value)
    local source = tostring(value or "document")
    source = source:gsub("[^A-Za-z0-9%._%-]", function(character)
        return string.format("~%02x~", string.byte(character))
    end)
    if source == "" then return "document" end
    return source
end

return Store
