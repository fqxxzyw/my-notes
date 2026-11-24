package com.papernotes.android

import android.app.Application
import com.papernotes.android.data.AndroidKeystoreTokenStore
import com.papernotes.android.data.AttachmentFileStore
import com.papernotes.android.data.PaperNotesRepository
import com.papernotes.android.data.WorkspaceStorage

class PaperNotesApp : Application() {
    lateinit var repository: PaperNotesRepository
        private set

    override fun onCreate() {
        super.onCreate()
        val storage = WorkspaceStorage(filesDir)
        val attachments = AttachmentFileStore(filesDir)
        val tokenStore = AndroidKeystoreTokenStore(filesDir)
        repository = PaperNotesRepository(storage, attachments, tokenStore)
    }
}
