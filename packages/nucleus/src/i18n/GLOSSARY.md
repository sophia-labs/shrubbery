# English → Japanese UI terminology

Labels use concise nouns or verbs. Explanatory sentences use です／ます. Names supplied by people, document contents, model identifiers, IRIs, API field names, code, and quoted testimony retain their original text. Sophia, Sophia Chat, Sophia Compute, Sophia Desk, Sophia Cloud, Sophia Labs, Garden, Hoja, Choreograph, Grapevine, Phanes, Mithras Flow, Ovillo, Emporium, Shrubbery, and third-party product and font names remain unchanged.

| English term | Japanese | Usage |
| --- | --- | --- |
| document | ドキュメント | Editable document; not ファイル |
| graph | グラフ | The semantic graph, including a workspace graph |
| knowledge graph | ナレッジグラフ | Describes the product's underlying graph |
| workspace | ワークスペース | The user-facing working space; retains the graph/workspace distinction |
| wire | ワイヤー | A connection with a named relation |
| connection | 接続 | The general connection, independent of its representation |
| relation / relationship | 関係 | The meaning of a connection |
| predicate | 関係 | User-facing wire controls; RDF identifiers remain unchanged |
| backlink | バックリンク | An incoming reference |
| outgoing / incoming | 出る接続／入る接続 | Direction relative to the current object |
| board | ボード | Generic board; Mithras Flow is a product name |
| whiteboard | ホワイトボード | Collaborative drawing surface |
| canvas | キャンバス | Editor, Files, workflow, or drawing canvas |
| scene | シーン | Excalidraw scene and its projection |
| shape / element | 図形／要素 | A shape versus any scene element |
| arrow | 矢印 | A scene arrow; a promoted arrow can be a wire |
| card | カード | Object or document card |
| block | ブロック | Addressable unit of document content |
| being | ビーイング | Stable identity across multiple sittings; distinct from an executing agent body |
| agent | エージェント | General agent; registered names and IDs remain unchanged |
| body | 実行本体 | The runtime body, when discussing an agent |
| cast | キャスト | The beings assigned to a workflow |
| post | 担当 | A workflow role assigned to a being |
| sitting | 作業回 | One being's work on one item; counts use 作業回数: N回 |
| seat | 席 | A seat in the Demi register, distinct from a workflow post |
| workflow | ワークフロー | Named workflow, plan, and canvas |
| run | 実行 | One invocation; 実行履歴 for the list of runs |
| step | ステップ | One workflow step |
| phase / stage | フェーズ／ステージ | Preserve the original distinction |
| stack | スタック | Collection of items between workflow steps |
| item | 項目 | Generic item; counts use N件 |
| source | 出典 | A referenced document or material; source code is ソース |
| destination | 出力先 | Workflow output destination; a folder move uses 移動先 |
| gate | 実行条件 | Conditions and capabilities at a workflow boundary |
| ward | 保護条件 | Protective condition exposed by a workflow |
| typed object | 型付きオブジェクト | An object with a class contract |
| meaningful object | 意味付きオブジェクト | Meaningful Object as a UI concept |
| object | オブジェクト | Generic object |
| class | クラス | Type/class metadata; externally supplied class names remain unchanged |
| field | フィールド | A record field |
| face | 表示 | An object's presentation; the reader's font control uses 書体 |
| margin | 余白 | Document margin used for annotations and workflow results |
| testimony | 記録 | Preserves qualifications about origin and verification in accompanying copy |
| provenance | 来歴 | Where a result came from |
| register / ledger | 台帳 | Register of records; a hardware register is レジスター |
| letter | 書簡 | Demi correspondence |
| bead | ビーズ | A registered bead |
| acknowledgement | 受領確認 | Distinct from marking a return read |
| refusal / unfit | 拒否／不適合 | A refusal versus a result that does not fit its class |
| contested / disputed | 競合中／競合 | Concurrent records or disagreeing readings |
| proposal | 候補 | Candidate record when resolving concurrent writes |
| artifact | アーティファクト | Original/generated stored artifact; not an editable document |
| original | 原本 | Original uploaded file or its view |
| reader | リーダー | Read-only document surface |
| annotation | 注釈 | Original/source annotations |
| highlight | ハイライト | Text highlight |
| note | メモ | Short note; daily note is デイリーノート |
| leaf | メモ | Hoja's new-note action; layout leaves are described as panels in UI copy |
| folder | フォルダー | File organization |
| Files | ファイル | Explorer surface |
| snapshot | スナップショット | Stored document snapshot |
| restore point | 復元ポイント | Workspace restoration point |
| version / revision | バージョン／リビジョン | Preserve the source distinction |
| local copy | ローカルコピー | Separate from cloud confirmation and connection state |
| parked work | 保留中の作業 | Work retained for reapplication/export |
| settings / preferences | 設定／環境設定 | Settings page and groups of preferences |
| language | 言語 | English and 日本語 are displayed in their own languages |
| theme / skin | テーマ／スキン | Separate appearance dimensions |
| chrome | 画面構成 | Describes controls around the document |
| panel / sidebar | パネル／サイドバー | Shared shell terminology |
| inspector | インスペクター | Selection details surface |
| command palette | コマンドパレット | Searchable command interface |
| slash command | スラッシュコマンド | Slash insertion menu |
| outline / contents | アウトライン／目次 | Editing structure versus reader navigation |
| chart | チャート | Data visualization, distinct from a semantic graph |
| runtime | 実行環境 | User-facing runtime descriptions |
| cell | セル | Runtime cell or notebook cell, qualified by context |
| provider | プロバイダー | AI or service provider |
| token / credit | トークン／クレジット | Separate usage and billing quantities |
| chat / conversation | チャット／会話 | Chat surface and its conversation |
| voice | 声 | Choice of conversational model; registered voice names, including House, remain unchanged |
| composer | 入力 | Chat message input; accessible label is チャットの入力 |
| message | メッセージ | A conversation message |
| branch | 分岐 | Start a conversation from an earlier message |
| premium | プレミアム | Premium voice; pricing explanations retain their original units |
| context | 文脈 | Context carried into a conversation or available to Sophia |
| grant / permission | 権限 | Access grants; remove member uses メンバーを削除 |
| viewer / editor | 閲覧者／編集者 | Workspace access roles |
| publish | 公開 | Explicit publish operation |
| delete / remove | 削除 | Permanent deletion is 完全に削除 |
| save / create / restore | 保存／作成／復元 | Standard action labels |

Wire groups use Ground → 基盤, Critique → 検討, Genesis → 生成, Structure → 構造. Predicate labels and their A/B explanations are translated separately; their URI and direction are never changed. The source explanations for `requires` and `consequenceOf` appear to describe a direction different from the English labels. That pre-existing ambiguity needs product review.

No Japanese label was abbreviated to fit an existing control. Visual fit, especially narrow toolbars, the 40px whiteboard selection bar, and settings selectors, still needs browser review.
